import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "./db";
import * as s from "./db/schema";
import { AppError, audit, owner, projectFor, type Context } from "./security";
import { calculateAmount, classificationSchema, comparisonSchema, defaultRates, hoursSchema, id, money, requirementSchema, text, zeroHours, type ActionResult } from "./model";
import { generate } from "./ai/service";

const jsonArray = z.preprocess(v => { if (typeof v !== "string") return v; try { return JSON.parse(v); } catch { return null; } }, z.array(requirementSchema).max(30));
export const changeCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("change.create"), projectId: id, request: text }),
  z.object({ action: z.literal("change.analyze"), projectId: id, changeId: id, complex: z.boolean().default(false), force: z.boolean().default(false) }),
  z.object({ action: z.literal("change.review"), projectId: id, changeId: id, request: text, classification: classificationSchema, confidence: z.coerce.number().min(0).max(1), reason: text, newRequirements: jsonArray, affectedExistingRequirements: z.preprocess(v => typeof v === "string" ? v.split(",").map(i=>i.trim()).filter(Boolean) : v, z.array(id).max(30)).default([]), removedExclusions: z.preprocess(v => { if (typeof v !== "string") return v; try { return JSON.parse(v); } catch { return null; } }, z.array(text).max(30)).default([]), estimatedWork: hoursSchema, scheduleImpactDays: z.coerce.number().int().min(0).max(365), overrideAmount: z.preprocess(v => v === "" || v == null ? null : Number(v), money.nullable()), adjustmentReason: z.string().trim().max(5000).default("") }),
  z.object({ action: z.literal("change.withdraw"), projectId: id, changeId: id }),
  z.object({ action: z.literal("change.cancel"), projectId: id, changeId: id }),
]);
export async function executeChange(ctx: Context, input: unknown): Promise<ActionResult> {
  owner(ctx); const cmd = changeCommandSchema.parse(input);
  if (cmd.action === "change.analyze") {
    const source = await db.transaction(async tx => {
      const project = await projectFor(ctx, cmd.projectId, tx, true);
      const [change] = await tx.select().from(s.changes).where(and(eq(s.changes.id, cmd.changeId), eq(s.changes.projectId, project.id)));
      if (!change || !["DRAFT", "WAITING_INTERNAL_REVIEW"].includes(change.status)) throw new AppError("분석할 수 있는 변경 요청이 아닙니다.", 409);
      const [scope] = await tx.select().from(s.scopes).where(and(eq(s.scopes.projectId, project.id), eq(s.scopes.status, "APPROVED"))).orderBy(desc(s.scopes.version)).limit(1);
      if (scope?.id !== change.baseScopeId) throw new AppError("기준 Scope가 바뀌었습니다. 새 변경 요청을 만들어주세요.", 409);
      // ponytail: lexical retrieval suits <=100 requirements; add embeddings when recall measurements warrant it.
      const terms = [...new Set(change.request.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(t=>t.length>1).flatMap(t=>[t,t.slice(0,2)]))];
      const relevant = scope.document.requirements.map(r => ({ r, score: terms.filter(t => `${r.title} ${r.description} ${r.category}`.toLowerCase().includes(t)).length })).sort((a,b)=>b.score-a.score).slice(0,12).map(({r})=>r);
      const history = await tx.select({ request: s.changes.request, review: s.changes.review }).from(s.changes).where(and(eq(s.changes.projectId, project.id), eq(s.changes.status, "APPROVED"))).orderBy(desc(s.changes.number)).limit(3);
      return { project, change, scope, input: { scopeVersion: scope.version, request: change.request, requirementIndex: scope.document.requirements.map(r=>({id:r.id,title:r.title,category:r.category})), relevantRequirements: relevant, omittedDetails: relevant.length < scope.document.requirements.length, excluded: scope.document.excluded, assumptions: scope.document.assumptions, recentChanges: history.map(c=>({request:c.request,reason:c.review?.reason})), } };
    });
    const response = await generate(ctx, cmd.projectId, "compare", source.input, { force: cmd.force, complex: cmd.complex });
    const analysis = comparisonSchema.parse(response.result);
    if (analysis.removedExclusions.some(item => !source.scope.document.excluded.includes(item))) throw new AppError("AI가 참조한 제외 항목이 기준 Scope에 없습니다. 직접 검토해주세요.", 502);
    if (analysis.affectedExistingRequirements.some(id => !source.scope.document.requirements.some(r=>r.id===id))) throw new AppError("AI 결과의 기존 요구사항 참조가 올바르지 않습니다. 직접 검토해주세요.", 502);
    await db.transaction(async tx => {
      await projectFor(ctx, cmd.projectId, tx, true);
      const [current] = await tx.select().from(s.changes).where(eq(s.changes.id, cmd.changeId));
      if (current.revision !== source.change.revision || !["DRAFT", "WAITING_INTERNAL_REVIEW"].includes(current.status)) throw new AppError("분석 중 변경 요청이 수정되었습니다. 최신 내용으로 다시 분석해주세요.", 409);
      await tx.update(s.changes).set({ analysis, status: "WAITING_INTERNAL_REVIEW", reviewedBy: null, revision: sql`${s.changes.revision} + 1` }).where(eq(s.changes.id, current.id));
    });
    return { message: "비교 초안이 준비되었습니다. 담당자가 검토·확정해야 고객에게 공유할 수 있습니다." };
  }
  return db.transaction(async tx => {
    const project = await projectFor(ctx, cmd.projectId, tx, true);
    if (!["ACTIVE", "WAITING_CHANGE_APPROVAL"].includes(project.status)) throw new AppError("Scope가 승인된 진행 중 프로젝트에서 변경 요청을 관리해주세요.");
    const [latest] = await tx.select().from(s.scopes).where(and(eq(s.scopes.projectId, project.id), eq(s.scopes.status, "APPROVED"))).orderBy(desc(s.scopes.version)).limit(1);
    if (!latest) throw new AppError("먼저 고객의 Scope 승인을 받아주세요.");
    if (cmd.action === "change.create") {
      const [last] = await tx.select().from(s.changes).where(eq(s.changes.projectId, project.id)).orderBy(desc(s.changes.number)).limit(1);
      const [card] = await tx.select().from(s.rateCards).where(eq(s.rateCards.workspaceId, ctx.workspaceId));
      const [change] = await tx.insert(s.changes).values({ projectId: project.id, number: (last?.number ?? 0)+1, baseScopeId: latest.id, request: cmd.request, rates: card?.rates ?? defaultRates }).returning();
      await audit(tx, ctx, project.id, "CHANGE_CREATED", `CR #${change.number} · ${cmd.request}`);
      return { message: "변경 요청을 만들었습니다. AI 비교 또는 직접 검토를 진행해주세요.", redirect: `/projects/${project.id}/changes#${change.id}` };
    }
    const [change] = await tx.select().from(s.changes).where(and(eq(s.changes.id, cmd.changeId), eq(s.changes.projectId, project.id)));
    if (!change) throw new AppError("변경 요청을 찾을 수 없습니다.", 404);
    if (["APPROVED", "REJECTED", "CANCELLED"].includes(change.status)) throw new AppError("종료된 변경 요청은 수정할 수 없습니다. 새 요청을 만들어주세요.", 409);
    if (cmd.action === "change.review") {
      if (change.status === "WAITING_CLIENT_APPROVAL") throw new AppError("고객 승인 요청을 먼저 회수해주세요.", 409);
      if (latest.id !== change.baseScopeId) throw new AppError("기준 Scope가 변경되었습니다. 새 변경 요청이 필요합니다.", 409);
      const review = comparisonSchema.parse(cmd);
      if (review.removedExclusions.some(item => !latest.document.excluded.includes(item))) throw new AppError("기존 Scope에 있는 제외 항목만 해제할 수 있습니다.");
      if (review.classification === "IN_SCOPE" && review.removedExclusions.length) throw new AppError("제외 범위의 해제는 기존 범위에 포함되는 요청이 아닙니다.");
      if (review.affectedExistingRequirements.some(id => !latest.document.requirements.some(r=>r.id===id))) throw new AppError("기존 Scope에 없는 요구사항을 참조할 수 없습니다.");
      if (review.classification === "IN_SCOPE") {
        if (review.newRequirements.length || Object.values(review.estimatedWork).some(h=>h!==0) || review.scheduleImpactDays || (cmd.overrideAmount ?? 0)!==0) throw new AppError("기존 범위에 포함된 요청에는 추가 기능·비용·일정을 청구할 수 없습니다.");
      } else if (review.classification !== "UNCERTAIN" && !review.newRequirements.length) throw new AppError("추가되는 요구사항을 하나 이상 입력해주세요.");
      if (review.newRequirements.some(r => latest.document.requirements.some(e=>e.title===r.title))) throw new AppError("기존 요구사항과 중복되는 추가 기능이 있습니다. 실제 증가하는 범위를 명확히 입력해주세요.");
      if (cmd.overrideAmount !== null && !cmd.adjustmentReason) throw new AppError("추가 금액을 조정한 이유를 입력해주세요.");
      const amount = cmd.overrideAmount ?? calculateAmount(review.estimatedWork, change.rates);
      await tx.update(s.changes).set({ request: cmd.request, review, amount, adjustmentReason: cmd.adjustmentReason, reviewedBy: review.classification === "UNCERTAIN" ? null : ctx.userId, status: review.classification === "UNCERTAIN" ? "WAITING_INTERNAL_REVIEW" : "DRAFT", revision: sql`${s.changes.revision} + 1` }).where(eq(s.changes.id, change.id));
    } else {
      await tx.update(s.accessTokens).set({ revokedAt: new Date() }).where(eq(s.accessTokens.changeId, change.id));
      await tx.update(s.changes).set({ status: cmd.action === "change.cancel" ? "CANCELLED" : "DRAFT", revision: sql`${s.changes.revision} + 1` }).where(eq(s.changes.id, change.id));
      const pending = await tx.select().from(s.changes).where(and(eq(s.changes.projectId, project.id), eq(s.changes.status, "WAITING_CLIENT_APPROVAL")));
      if (!pending.length) await tx.update(s.projects).set({ status: "ACTIVE" }).where(eq(s.projects.id, project.id));
    }
    await audit(tx, ctx, project.id, cmd.action.toUpperCase().replace(".","_"), `CR #${change.number}`);
    return { message: "변경 요청을 저장했습니다." };
  });
}
export const emptyReview = { classification: "UNCERTAIN" as const, confidence: 0, reason: "기존 Scope와 추가 요청의 범위를 검토해주세요.", newRequirements: [], affectedExistingRequirements: [], removedExclusions: [], estimatedWork: zeroHours, scheduleImpactDays: 0 };
