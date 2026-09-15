import { z } from "zod";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { db, type Transaction } from "./db";
import * as s from "./db/schema";
import { AppError, audit, hashToken, owner, projectFor, type Context } from "./security";
import { calculateAmount, dateSchema, defaultRates, hoursSchema, id, money, rateSchema, requirementSchema, title, text, type ActionResult, type ScopeDocument } from "./model";

const optionalDate = z.union([dateSchema, z.literal("")]).transform(v => v || null);
const optionalMoney = z.preprocess(v => v === "" || v == null ? null : Number(v), money.nullable());
const notes = z.string().trim().max(5000).default("");
const clientInput = z.object({ name: title, email: z.email().max(254), company: z.string().max(160).default(""), phone: z.string().max(50).default(""), notes });
const projectInput = z.object({ name: title, clientId: id, budget: optionalMoney, deadline: optionalDate, referenceUrl: z.union([z.url().refine(v => /^https?:\/\//.test(v)), z.literal("")]).default(""), notes });
export const commandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("workspace.create"), name: title }),
  z.object({ action: z.literal("workspace.update"), name: title }),
  z.object({ action: z.literal("workspace.switch"), workspaceId: id }),
  z.object({ action: z.literal("member.add"), email: z.email() }),
  z.object({ action: z.literal("client.save"), clientId: id.optional(), ...clientInput.shape }),
  z.object({ action: z.literal("client.delete"), clientId: id }),
  z.object({ action: z.literal("project.create"), ...projectInput.shape, content: text }),
  z.object({ action: z.literal("project.update"), projectId: id, ...projectInput.shape }),
  z.object({ action: z.literal("project.status"), projectId: id, status: z.enum(["COMPLETED", "CANCELLED", "ACTIVE"]) }),
  z.object({ action: z.literal("project.delete"), projectId: id }),
  z.object({ action: z.literal("initial.save"), projectId: id, content: text }),
  z.object({ action: z.literal("question.save"), projectId: id, questionId: id.optional(), question: text, reason: notes }),
  z.object({ action: z.literal("question.delete"), projectId: id, questionId: id }),
  z.object({ action: z.literal("answer.save"), projectId: id, questionId: id, content: text }),
  z.object({ action: z.literal("requirement.save"), projectId: id, requirementId: id.optional(), ...requirementSchema.shape }),
  z.object({ action: z.literal("requirement.delete"), projectId: id, requirementId: id }),
  z.object({ action: z.literal("rates.save"), rates: rateSchema }),
  z.object({ action: z.literal("credits.save"), creditLimit: z.coerce.number().int().min(0).max(10000), userCreditLimit: z.coerce.number().int().min(0).max(10000), creditCosts: z.object({ initial: z.number().int().min(1).max(100), questions: z.number().int().min(1).max(100), requirements: z.number().int().min(1).max(100), estimate: z.number().int().min(1).max(100), summary: z.number().int().min(1).max(100), compare: z.number().int().min(1).max(100) }) }),
  z.object({ action: z.literal("estimate.item"), projectId: id, requirementId: id, hours: hoursSchema, reason: text }),
  z.object({ action: z.literal("estimate.total"), projectId: id, overrideTotal: optionalMoney, adjustmentReason: notes }),
  z.object({ action: z.literal("scope.create"), projectId: id, description: text, excluded: notes, assumptions: notes, integrations: notes, deliverables: text, durationDays: z.coerce.number().int().min(1).max(3650) }),
  z.object({ action: z.literal("scope.edit"), projectId: id, scopeId: id, description: text, excluded: notes, assumptions: notes, integrations: notes, deliverables: text, durationDays: z.coerce.number().int().min(1).max(3650) }),
  z.object({ action: z.literal("share.create"), projectId: id, purpose: z.enum(["QUESTIONS", "SCOPE", "CHANGE"]), targetId: id.optional() }),
  z.object({ action: z.literal("share.revoke"), projectId: id, tokenId: id }),
  z.object({ action: z.literal("scope.withdraw"), projectId: id, scopeId: id }),
]);
export type Command = z.infer<typeof commandSchema>;

export async function editable(tx: Transaction, projectId: string) {
  const frozen = await tx.select({ id: s.scopes.id }).from(s.scopes).where(and(eq(s.scopes.projectId, projectId), inArray(s.scopes.status, ["APPROVED", "WAITING_APPROVAL"])));
  if (frozen.length) throw new AppError("승인 중이거나 승인된 범위는 직접 수정할 수 없습니다. 승인 요청을 회수하거나 변경 요청을 만들어주세요.", 409);
}
export async function bump(tx: Transaction, projectId: string) {
  await tx.update(s.projects).set({ revision: sql`${s.projects.revision} + 1`, updatedAt: new Date() }).where(eq(s.projects.id, projectId));
}
export async function ensureEstimate(tx: Transaction, projectId: string, workspaceId: string) {
  let [estimate] = await tx.select().from(s.estimates).where(eq(s.estimates.projectId, projectId));
  if (!estimate) {
    const [card] = await tx.select().from(s.rateCards).where(eq(s.rateCards.workspaceId, workspaceId));
    [estimate] = await tx.insert(s.estimates).values({ projectId, rates: card?.rates ?? defaultRates }).returning();
  }
  return estimate;
}
const lines = (value: string) => value.split("\n").map(v => v.trim()).filter(Boolean);
export async function buildDocument(tx: Transaction, ctx: Context, project: typeof s.projects.$inferSelect, input: { description: string; excluded: string; assumptions: string; integrations: string; deliverables: string; durationDays: number }): Promise<ScopeDocument> {
  const requirements = await tx.select().from(s.requirements).where(eq(s.requirements.projectId, project.id));
  if (!requirements.length) throw new AppError("먼저 요구사항을 추가해주세요.");
  const estimate = await ensureEstimate(tx, project.id, ctx.workspaceId);
  const items = await tx.select().from(s.estimateItems).where(eq(s.estimateItems.estimateId, estimate.id));
  if (requirements.some(r => !items.some(i => i.requirementId === r.id && i.reviewed))) throw new AppError("모든 요구사항의 예상 작업 시간을 검토·저장해주세요.");
  const result = requirements.map(r => { const item = items.find(i => i.requirementId === r.id)!; return { requirementId: r.id, title: r.title, hours: item.hours, complexity: item.complexity, reason: item.reason, amount: calculateAmount(item.hours, estimate.rates) }; });
  const subtotal = money.parse(result.reduce((sum, item) => sum + item.amount, 0));
  return { description: input.description, excluded: lines(input.excluded), assumptions: lines(input.assumptions), integrations: lines(input.integrations), deliverables: lines(input.deliverables), durationDays: input.durationDays, deadline: project.deadline, requirements: requirements.map(r => ({ ...requirementSchema.parse(r), id: r.id, source: r.source })), estimate: { items: result, rates: estimate.rates, subtotal, total: estimate.overrideTotal ?? subtotal, adjustmentReason: estimate.adjustmentReason } };
}

export async function executeCommand(ctx: Context, input: unknown): Promise<ActionResult> {
  const cmd = commandSchema.parse(input);
  if (["question.save", "question.delete", "answer.save", "requirement.save", "requirement.delete"].includes(cmd.action) === false) owner(ctx);
  return db.transaction(async tx => {
    const project = "projectId" in cmd ? await projectFor(ctx, cmd.projectId, tx, true) : null;
    if (project && ["COMPLETED", "CANCELLED"].includes(project.status) && !["project.status", "share.revoke"].includes(cmd.action)) throw new AppError("종료된 프로젝트는 진행 중으로 전환한 뒤 수정해주세요.", 409);
    switch (cmd.action) {
      case "workspace.create": {
        const [workspace] = await tx.insert(s.workspaces).values({ name: cmd.name }).returning();
        await tx.insert(s.members).values({ workspaceId: workspace.id, userId: ctx.userId, role: "OWNER" });
        await tx.insert(s.rateCards).values({ workspaceId: workspace.id });
        return { redirect: `/onboarding?workspace=${workspace.id}`, message: "Workspace가 생성되었습니다." };
      }
      case "workspace.update": await tx.update(s.workspaces).set({ name: cmd.name }).where(eq(s.workspaces.id, ctx.workspaceId)); break;
      case "workspace.switch": throw new AppError("잘못된 요청입니다.");
      case "member.add": {
        const [member] = await tx.select().from(s.user).where(eq(s.user.email, cmd.email.toLowerCase()));
        if (!member) throw new AppError("먼저 서비스에 가입한 사용자의 이메일을 입력해주세요.");
        await tx.insert(s.members).values({ workspaceId: ctx.workspaceId, userId: member.id }).onConflictDoNothing(); break;
      }
      case "client.save": {
        const data = clientInput.parse(cmd);
        if (cmd.clientId) {
          const updated = await tx.update(s.clients).set({ ...data, updatedAt: new Date() }).where(and(eq(s.clients.id, cmd.clientId), eq(s.clients.workspaceId, ctx.workspaceId))).returning();
          if (!updated.length) throw new AppError("고객을 찾을 수 없습니다.", 404);
        } else await tx.insert(s.clients).values({ ...data, workspaceId: ctx.workspaceId });
        break;
      }
      case "client.delete": {
        if ((await tx.select({ id: s.projects.id }).from(s.projects).where(and(eq(s.projects.clientId, cmd.clientId), eq(s.projects.workspaceId, ctx.workspaceId)))).length) throw new AppError("프로젝트가 연결된 고객은 삭제할 수 없습니다.");
        await tx.delete(s.clients).where(and(eq(s.clients.id, cmd.clientId), eq(s.clients.workspaceId, ctx.workspaceId))); break;
      }
      case "project.create":
      case "project.update": {
        const [client] = await tx.select().from(s.clients).where(and(eq(s.clients.id, cmd.clientId), eq(s.clients.workspaceId, ctx.workspaceId)));
        if (!client) throw new AppError("Workspace의 고객을 선택해주세요.");
        const data = projectInput.parse(cmd);
        if (cmd.action === "project.create") {
          const [created] = await tx.insert(s.projects).values({ ...data, workspaceId: ctx.workspaceId, status: "REQUIREMENT_GATHERING" }).returning();
          await tx.insert(s.initialRequests).values({ projectId: created.id, content: cmd.content });
          await audit(tx, ctx, created.id, "PROJECT_CREATED", created.name);
          return { redirect: `/projects/${created.id}` };
        }
        await editable(tx, project!.id);
        await tx.update(s.projects).set(data).where(eq(s.projects.id, project!.id));
        await bump(tx, project!.id); break;
      }
      case "project.status": {
        if (project!.status === "WAITING_SCOPE_APPROVAL" || project!.status === "WAITING_CHANGE_APPROVAL") throw new AppError("진행 중인 승인 요청을 먼저 처리해주세요.");
        if (cmd.status === "ACTIVE" || cmd.status === "COMPLETED") {
          if (!(await tx.select().from(s.scopes).where(and(eq(s.scopes.projectId, project!.id), eq(s.scopes.status, "APPROVED")))).length) throw new AppError("Scope 승인 후 변경할 수 있는 상태입니다.");
        }
        await tx.update(s.projects).set({ status: cmd.status, updatedAt: new Date() }).where(eq(s.projects.id, project!.id)); break;
      }
      case "project.delete": {
        const [scope] = await tx.select().from(s.scopes).where(eq(s.scopes.projectId, project!.id)).limit(1);
        const [usage] = await tx.select().from(s.aiUsage).where(eq(s.aiUsage.projectId, project!.id)).limit(1);
        const [token] = await tx.select().from(s.accessTokens).where(eq(s.accessTokens.projectId, project!.id)).limit(1);
        if (scope || usage || token) throw new AppError("문서·공유·AI 사용 이력이 있는 프로젝트는 삭제 대신 취소해주세요.");
        await tx.update(s.auditLogs).set({ projectId: null }).where(eq(s.auditLogs.projectId, project!.id));
        await tx.delete(s.projects).where(eq(s.projects.id, project!.id));
        await audit(tx, ctx, null, "PROJECT_DELETED", project!.name);
        return { redirect: "/projects" };
      }
      case "initial.save": await editable(tx, project!.id); await tx.update(s.initialRequests).set({ content: cmd.content, analysis: null, updatedAt: new Date() }).where(eq(s.initialRequests.projectId, project!.id)); await bump(tx, project!.id); break;
      case "question.save": {
        await editable(tx, project!.id);
        const data = { question: cmd.question, reason: cmd.reason };
        if (cmd.questionId) await tx.update(s.questions).set(data).where(and(eq(s.questions.id, cmd.questionId), eq(s.questions.projectId, project!.id)));
        else {
          const count = (await tx.select({ id: s.questions.id }).from(s.questions).where(eq(s.questions.projectId, project!.id))).length;
          if (count >= 8) throw new AppError("질문은 한 번에 최대 8개까지 관리할 수 있습니다.");
          await tx.insert(s.questions).values({ ...data, projectId: project!.id, position: count });
        }
        await bump(tx, project!.id); break;
      }
      case "question.delete": await editable(tx, project!.id); await tx.delete(s.questions).where(and(eq(s.questions.id, cmd.questionId), eq(s.questions.projectId, project!.id))); await bump(tx, project!.id); break;
      case "answer.save": {
        await editable(tx, project!.id);
        const [question] = await tx.select().from(s.questions).where(and(eq(s.questions.id, cmd.questionId), eq(s.questions.projectId, project!.id)));
        if (!question) throw new AppError("질문을 찾을 수 없습니다.", 404);
        await tx.insert(s.answers).values({ questionId: question.id, content: cmd.content, author: ctx.userId }).onConflictDoUpdate({ target: s.answers.questionId, set: { content: cmd.content, author: ctx.userId, updatedAt: new Date() } });
        await bump(tx, project!.id); break;
      }
      case "requirement.save": {
        await editable(tx, project!.id);
        if (cmd.requirementId) await tx.update(s.requirements).set({ ...requirementSchema.parse(cmd), updatedAt: new Date() }).where(and(eq(s.requirements.id, cmd.requirementId), eq(s.requirements.projectId, project!.id)));
        else await tx.insert(s.requirements).values({ ...requirementSchema.parse(cmd), projectId: project!.id, source: "OWNER_MANUAL" });
        await bump(tx, project!.id); break;
      }
      case "requirement.delete": await editable(tx, project!.id); await tx.delete(s.requirements).where(and(eq(s.requirements.id, cmd.requirementId), eq(s.requirements.projectId, project!.id))); await bump(tx, project!.id); break;
      case "rates.save": await tx.insert(s.rateCards).values({ workspaceId: ctx.workspaceId, rates: cmd.rates }).onConflictDoUpdate({ target: s.rateCards.workspaceId, set: { rates: cmd.rates, updatedAt: new Date() } }); break;
      case "credits.save": await tx.update(s.workspaces).set({ creditLimit: cmd.creditLimit, userCreditLimit: cmd.userCreditLimit, creditCosts: cmd.creditCosts }).where(eq(s.workspaces.id, ctx.workspaceId)); break;
      case "estimate.item": {
        await editable(tx, project!.id);
        const [requirement] = await tx.select().from(s.requirements).where(and(eq(s.requirements.id, cmd.requirementId), eq(s.requirements.projectId, project!.id)));
        if (!requirement) throw new AppError("요구사항을 찾을 수 없습니다.", 404);
        const estimate = await ensureEstimate(tx, project!.id, ctx.workspaceId);
        const [rateCard] = await tx.select().from(s.rateCards).where(eq(s.rateCards.workspaceId, ctx.workspaceId));
        await tx.update(s.estimates).set({ rates: rateCard?.rates ?? defaultRates, updatedAt: new Date() }).where(eq(s.estimates.id, estimate.id));
        await tx.insert(s.estimateItems).values({ estimateId: estimate.id, requirementId: requirement.id, hours: cmd.hours, reason: cmd.reason, reviewed: true }).onConflictDoUpdate({ target: [s.estimateItems.estimateId, s.estimateItems.requirementId], set: { hours: cmd.hours, reason: cmd.reason, reviewed: true } });
        await bump(tx, project!.id); break;
      }
      case "estimate.total": {
        await editable(tx, project!.id);
        if (cmd.overrideTotal !== null && !cmd.adjustmentReason) throw new AppError("최종 금액을 조정한 이유를 입력해주세요.");
        const estimate = await ensureEstimate(tx, project!.id, ctx.workspaceId);
        await tx.update(s.estimates).set({ overrideTotal: cmd.overrideTotal, adjustmentReason: cmd.adjustmentReason, updatedAt: new Date() }).where(eq(s.estimates.id, estimate.id)); await bump(tx, project!.id); break;
      }
      case "scope.create":
      case "scope.edit": {
        await editable(tx, project!.id);
        const document = await buildDocument(tx, ctx, project!, cmd);
        if (cmd.action === "scope.edit") {
          const updated = await tx.update(s.scopes).set({ document, basedOnRevision: project!.revision }).where(and(eq(s.scopes.id, cmd.scopeId), eq(s.scopes.projectId, project!.id), eq(s.scopes.status, "DRAFT"))).returning();
          if (!updated.length) throw new AppError("수정 가능한 Scope 초안이 없습니다.", 409);
        } else {
          const [latest] = await tx.select().from(s.scopes).where(eq(s.scopes.projectId, project!.id)).orderBy(desc(s.scopes.version)).limit(1);
          if (latest?.status === "DRAFT") throw new AppError("기존 Scope 초안을 수정해주세요.");
          await tx.insert(s.scopes).values({ projectId: project!.id, version: (latest?.version ?? 0) + 1, basedOnRevision: project!.revision, document });
        }
        break;
      }
      case "share.create": {
        const target = cmd.targetId;
        let scopeId: string | null = null; let changeId: string | null = null;
        if (cmd.purpose === "SCOPE") {
          const [scope] = await tx.select().from(s.scopes).where(and(eq(s.scopes.id, target ?? ""), eq(s.scopes.projectId, project!.id)));
          if (!scope || !["DRAFT", "WAITING_APPROVAL"].includes(scope.status)) throw new AppError("승인을 요청할 Scope 초안이 없습니다.");
          if (scope.basedOnRevision !== project!.revision) throw new AppError("요구사항이나 견적이 바뀌었습니다. Scope 초안을 저장하여 갱신해주세요.", 409);
          await tx.update(s.scopes).set({ status: "WAITING_APPROVAL" }).where(eq(s.scopes.id, scope.id)); scopeId = scope.id;
          await tx.update(s.projects).set({ status: "WAITING_SCOPE_APPROVAL" }).where(eq(s.projects.id, project!.id));
        } else if (cmd.purpose === "CHANGE") {
          const [change] = await tx.select().from(s.changes).where(and(eq(s.changes.id, target ?? ""), eq(s.changes.projectId, project!.id)));
          if (!change || !change.review || !change.reviewedBy || change.review.classification === "UNCERTAIN" || !["DRAFT", "WAITING_CLIENT_APPROVAL"].includes(change.status)) throw new AppError("변경 요청을 내부 검토·확정한 뒤 공유해주세요.");
          const [latest] = await tx.select().from(s.scopes).where(and(eq(s.scopes.projectId, project!.id), eq(s.scopes.status, "APPROVED"))).orderBy(desc(s.scopes.version)).limit(1);
          if (latest?.id !== change.baseScopeId) throw new AppError("기준 Scope가 변경되었습니다. 새 변경 요청을 만들어주세요.", 409);
          const other = await tx.select().from(s.changes).where(and(eq(s.changes.projectId, project!.id), eq(s.changes.status, "WAITING_CLIENT_APPROVAL")));
          if (other.some(c => c.id !== change.id)) throw new AppError("다른 변경 요청의 승인을 먼저 완료해주세요.");
          await tx.update(s.changes).set({ status: "WAITING_CLIENT_APPROVAL" }).where(eq(s.changes.id, change.id)); changeId = change.id;
          await tx.update(s.projects).set({ status: "WAITING_CHANGE_APPROVAL" }).where(eq(s.projects.id, project!.id));
        } else { await editable(tx, project!.id); }
        const token = randomBytes(32).toString("base64url");
        await tx.insert(s.accessTokens).values({ projectId: project!.id, scopeId, changeId, purpose: cmd.purpose, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 14 * 86400000) });
        await audit(tx, ctx, project!.id, "SHARE_CREATED", cmd.purpose);
        return { link: `/client/${token}`, message: "14일간 유효한 공유 링크입니다. 지금 복사해 고객에게 전달해주세요." };
      }
      case "share.revoke": await tx.update(s.accessTokens).set({ revokedAt: new Date() }).where(and(eq(s.accessTokens.id, cmd.tokenId), eq(s.accessTokens.projectId, project!.id))); break;
      case "scope.withdraw": {
        const updated = await tx.update(s.scopes).set({ status: "DRAFT" }).where(and(eq(s.scopes.id, cmd.scopeId), eq(s.scopes.projectId, project!.id), eq(s.scopes.status, "WAITING_APPROVAL"))).returning();
        if (!updated.length) throw new AppError("회수할 승인 요청이 없습니다.", 409);
        await tx.update(s.accessTokens).set({ revokedAt: new Date() }).where(eq(s.accessTokens.scopeId, cmd.scopeId));
        await tx.update(s.projects).set({ status: "REQUIREMENT_GATHERING" }).where(eq(s.projects.id, project!.id)); break;
      }
    }
    await audit(tx, ctx, project?.id ?? null, cmd.action.toUpperCase().replace(".", "_"), "title" in cmd ? cmd.title : "name" in cmd ? cmd.name : cmd.action);
    return { message: "저장했습니다." };
  });
}
