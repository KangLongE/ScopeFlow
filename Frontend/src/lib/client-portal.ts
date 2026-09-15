import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, type Transaction } from "./db";
import * as s from "./db/schema";
import { AppError, audit, hashToken } from "./security";
import { addDays, calculateAmount, id, money, requirementSchema, text, title, type ActionResult } from "./model";

const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export async function tokenFor(raw: string, tx: Transaction | typeof db = db) {
  if (!tokenSchema.safeParse(raw).success) throw new AppError("유효하지 않은 공유 링크입니다.", 404);
  const [token] = await tx.select().from(s.accessTokens).where(eq(s.accessTokens.tokenHash, hashToken(raw)));
  if (!token || token.revokedAt || token.expiresAt <= new Date()) throw new AppError("만료되었거나 회수된 공유 링크입니다. 담당자에게 새 링크를 요청해주세요.", 404);
  return token;
}
export async function portalData(raw: string) {
  const token = await tokenFor(raw);
  const [project] = await db.select().from(s.projects).where(eq(s.projects.id, token.projectId));
  const [workspace] = await db.select().from(s.workspaces).where(eq(s.workspaces.id, project.workspaceId));
  const [scope] = token.scopeId ? await db.select().from(s.scopes).where(and(eq(s.scopes.id, token.scopeId), eq(s.scopes.projectId, project.id))) : [];
  const [change] = token.changeId ? await db.select().from(s.changes).where(and(eq(s.changes.id, token.changeId), eq(s.changes.projectId, project.id))) : [];
  const [baseScope] = change ? await db.select().from(s.scopes).where(and(eq(s.scopes.id, change.baseScopeId), eq(s.scopes.projectId, project.id))) : [];
  const questions = token.purpose === "QUESTIONS" ? await db.select({ id: s.questions.id, question: s.questions.question, reason: s.questions.reason, answer: s.answers.content }).from(s.questions).leftJoin(s.answers, eq(s.answers.questionId, s.questions.id)).where(eq(s.questions.projectId, project.id)).orderBy(s.questions.position) : [];
  // Only client-facing fields leave this function. No token hash, internal notes, AI input, or rate settings.
  return { project: { name: project.name, status: project.status }, workspaceName: workspace.name, purpose: token.purpose, expiresAt: token.expiresAt, scope: scope ? { id: scope.id, document: scope.document, status: scope.status, version: scope.version, approvedAt: scope.approvedAt, approvedBy: scope.approvedBy } : null, change: change ? { number: change.number, request: change.request, review: change.review, amount: change.amount, status: change.status, approvedAt: change.approvedAt, approvedBy: change.approvedBy, baseDeadline: baseScope?.document.deadline ?? null, newDeadline: addDays(baseScope?.document.deadline ?? null, change.review?.scheduleImpactDays ?? 0) } : null, questions };
}
export const portalCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("client.answer"), token: tokenSchema, questionId: id, content: text, name: title }),
  z.object({ action: z.literal("client.decide"), token: tokenSchema, decision: z.enum(["APPROVE", "REVISE", "REJECT"]), name: title, message: z.string().trim().max(5000).default(""), consent: z.literal("on") }),
]);
export async function executePortal(input: unknown): Promise<ActionResult> {
  const cmd = portalCommandSchema.parse(input);
  const preflight = await tokenFor(cmd.token);
  return db.transaction(async tx => {
    const [project] = await tx.select().from(s.projects).where(eq(s.projects.id, preflight.projectId)).for("update");
    const token = await tokenFor(cmd.token, tx);
    const ctx = { userId: `CLIENT:${cmd.name}`, workspaceId: project.workspaceId, role: "OWNER" as const };
    if (["COMPLETED", "CANCELLED"].includes(project.status)) throw new AppError("종료된 프로젝트입니다. 담당자에게 문의해주세요.", 409);
    if (cmd.action === "client.answer") {
      if (token.purpose !== "QUESTIONS") throw new AppError("답변용 링크가 아닙니다.", 403);
      const frozen = await tx.select().from(s.scopes).where(and(eq(s.scopes.projectId, project.id), sql`${s.scopes.status} IN ('APPROVED','WAITING_APPROVAL')`));
      if (frozen.length) throw new AppError("Scope 확인이 시작되어 질문 답변이 마감되었습니다.", 409);
      const [question] = await tx.select().from(s.questions).where(and(eq(s.questions.id, cmd.questionId), eq(s.questions.projectId, project.id)));
      if (!question) throw new AppError("질문을 찾을 수 없습니다.", 404);
      await tx.insert(s.answers).values({ questionId: question.id, content: cmd.content, author: cmd.name }).onConflictDoUpdate({ target: s.answers.questionId, set: { content: cmd.content, author: cmd.name, updatedAt: new Date() } });
      await tx.update(s.projects).set({ revision: sql`${s.projects.revision} + 1`, updatedAt: new Date() }).where(eq(s.projects.id, project.id));
      await audit(tx, ctx, project.id, "CLIENT_ANSWER", question.question);
      return { message: "답변을 전달했습니다. 감사합니다." };
    }
    if (token.purpose === "QUESTIONS") throw new AppError("승인용 링크가 아닙니다.", 403);
    if (cmd.decision !== "APPROVE" && !cmd.message) throw new AppError("수정 또는 거절 이유를 입력해주세요.");
    if (token.purpose === "SCOPE") {
      const [scope] = await tx.select().from(s.scopes).where(and(eq(s.scopes.id, token.scopeId!), eq(s.scopes.projectId, project.id)));
      if (!scope) throw new AppError("문서를 찾을 수 없습니다.", 404);
      if (scope.status === "APPROVED" && cmd.decision === "APPROVE") return { message: "이미 승인된 Scope입니다." };
      if (scope.status !== "WAITING_APPROVAL") throw new AppError("현재 승인 대기 중인 문서가 아닙니다.", 409);
      if (cmd.decision === "REJECT") throw new AppError("Scope는 수정 요청으로 의견을 전달해주세요.");
      if (cmd.decision === "APPROVE") {
        if (scope.basedOnRevision !== project.revision) throw new AppError("문서가 변경되었습니다. 담당자에게 새 문서를 요청해주세요.", 409);
        await tx.update(s.scopes).set({ status: "APPROVED", approvedAt: new Date(), approvedBy: cmd.name }).where(eq(s.scopes.id, scope.id));
        await tx.update(s.projects).set({ status: "ACTIVE", deadline: scope.document.deadline, updatedAt: new Date() }).where(eq(s.projects.id, project.id));
        await audit(tx, ctx, project.id, "SCOPE_APPROVED", `Scope v1.${scope.version-1} · ${cmd.name}`);
      } else {
        await tx.update(s.scopes).set({ status: "DRAFT" }).where(eq(s.scopes.id, scope.id));
        await tx.update(s.accessTokens).set({ revokedAt: new Date() }).where(eq(s.accessTokens.scopeId, scope.id));
        await tx.update(s.projects).set({ status: "REQUIREMENT_GATHERING" }).where(eq(s.projects.id, project.id));
      }
    } else {
      const [change] = await tx.select().from(s.changes).where(and(eq(s.changes.id, token.changeId!), eq(s.changes.projectId, project.id)));
      if (!change) throw new AppError("변경 요청을 찾을 수 없습니다.", 404);
      if (change.status === "APPROVED" && cmd.decision === "APPROVE") return { message: "이미 승인된 변경 요청입니다." };
      if (change.status !== "WAITING_CLIENT_APPROVAL" || !change.review || !change.reviewedBy || change.review.classification === "UNCERTAIN") throw new AppError("현재 승인할 수 없는 변경 요청입니다.", 409);
      if (cmd.decision === "APPROVE") {
        const [base] = await tx.select().from(s.scopes).where(and(eq(s.scopes.projectId, project.id), eq(s.scopes.status, "APPROVED"))).orderBy(desc(s.scopes.version)).limit(1);
        if (base.id !== change.baseScopeId) throw new AppError("기준 Scope가 변경되었습니다. 최신 변경 요청을 확인해주세요.", 409);
        const document = structuredClone(base.document);
        document.excluded = document.excluded.filter(item => !(change.review!.removedExclusions ?? []).includes(item));
        if (document.requirements.length + change.review.newRequirements.length > 100) throw new AppError("프로젝트 요구사항 한도를 초과했습니다. 담당자에게 문의해주세요.");
        for (const item of change.review.newRequirements) {
          const [requirement] = await tx.insert(s.requirements).values({ ...requirementSchema.parse(item), projectId: project.id, source: "CHANGE_REQUEST" }).returning();
          document.requirements.push({ ...requirementSchema.parse(item), id: requirement.id, source: "CHANGE_REQUEST" });
        }
        document.estimate.items.push({ requirementId: `CR-${change.number}`, title: `변경 요청 #${change.number}`, hours: change.review.estimatedWork, complexity: "MEDIUM", reason: `${change.review.reason}${change.adjustmentReason ? ` · 금액 조정: ${change.adjustmentReason}` : ""}`, amount: change.amount });
        document.estimate.subtotal = money.parse(document.estimate.subtotal + calculateAmount(change.review.estimatedWork, change.rates));
        document.estimate.total = money.parse(document.estimate.total + change.amount);
        document.durationDays += change.review.scheduleImpactDays;
        document.deadline = addDays(document.deadline, change.review.scheduleImpactDays);
        document.description = `${document.description}\n\n변경 요청 #${change.number}: ${change.request}`;
        const [created] = await tx.insert(s.scopes).values({ projectId: project.id, version: base.version+1, status: "APPROVED", document, basedOnRevision: project.revision+1, approvedAt: new Date(), approvedBy: cmd.name }).returning();
        await tx.update(s.changes).set({ status: "APPROVED", resultScopeId: created.id, approvedAt: new Date(), approvedBy: cmd.name }).where(eq(s.changes.id, change.id));
        await tx.update(s.projects).set({ revision: sql`${s.projects.revision}+1`, deadline: document.deadline, updatedAt: new Date() }).where(eq(s.projects.id, project.id));
        await audit(tx, ctx, project.id, "CHANGE_APPROVED", `CR #${change.number} → Scope v1.${created.version-1}`);
      } else {
        await tx.update(s.changes).set({ status: cmd.decision === "REJECT" ? "REJECTED" : "DRAFT", reviewedBy: cmd.decision === "REVISE" ? null : change.reviewedBy, revision: sql`${s.changes.revision}+1` }).where(eq(s.changes.id, change.id));
        await tx.update(s.accessTokens).set({ revokedAt: new Date() }).where(eq(s.accessTokens.changeId, change.id));
      }
      await tx.update(s.projects).set({ status: "ACTIVE" }).where(eq(s.projects.id, project.id));
    }
    await tx.insert(s.feedback).values({ projectId: project.id, tokenId: token.id, decision: cmd.decision, name: cmd.name, message: cmd.message || "문서의 범위와 견적을 확인하고 승인했습니다." });
    await audit(tx, ctx, project.id, `CLIENT_${cmd.decision}`, cmd.message || cmd.decision);
    return { message: cmd.decision === "APPROVE" ? "승인했습니다. 확인해주셔서 감사합니다." : "의견을 담당자에게 전달했습니다. 수정된 문서는 새 링크로 전달됩니다.", ...(cmd.decision !== "APPROVE" ? {redirect:"/client/complete"} : {}) };
  });
}
