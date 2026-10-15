import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/errors";
import type { SessionContext } from "@/lib/auth/session";
import { requireEditable, requireOwner } from "@/lib/auth/permissions";
import { calculateAmount, comparisonSchema, estimateResultSchema, hoursSchema, initialAnalysisSchema, questionsResultSchema, requirementsResultSchema, ratesSchema, reviewNotesSchema, requirementInputSchema, scopeAIResultSchema } from "@/lib/model";
import { generateAI, executionView } from "@/lib/ai/ai.service";
import { executionFingerprint, type AIExecutionOptions } from "@/lib/ai/usage-policy";
import { audit, editDraft, lockProject, projectFor, requireDraft } from "./shared";
import { buildProjectAIContext, changedContext, markEstimateForReview, recordAIReview, requireFreshAIContext, reviewIssues, validateContextResult, type ProjectAIContext } from "./ai-context.service";
import { initialReview, revalidate, requireValidated, saveReviewState, assertCandidateRevision, auditValidation, type ReviewState } from "./ai-validation.service";
import { type ValidationResult, type ValidationPolicy } from "@/lib/ai/rule-validator";

const jsonValue = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
type Task = "initial" | "questions" | "requirements" | "estimate" | "summary";
const schemas = { initial: initialAnalysisSchema, questions: questionsResultSchema, requirements: requirementsResultSchema, estimate: estimateResultSchema, summary: scopeAIResultSchema };
const operations = { initial: "INITIAL_ANALYSIS", questions: "QUESTIONS", requirements: "REQUIREMENTS", estimate: "ESTIMATE", summary: "SCOPE_SUMMARY" } as const;
export type Draft = { revision: number; result: unknown; createdAt: string; runId: string; inputFingerprint: string; operation: ProjectAIContext["operation"]; context: ProjectAIContext; issues: ReturnType<typeof reviewIssues>; status: "READY" | "CHANGED" } & ReviewState;
const draftsOf = (value: Prisma.JsonValue) => value as unknown as Partial<Record<Task, Draft>>;

async function ready(context: SessionContext, projectId: string) {
  requireOwner(context);
  const project = await projectFor(context, projectId);
  await requireDraft(project);
  return project;
}
async function saveDraft(context: SessionContext, projectId: string, task: Task, run: { data: unknown; runId: string; context: ProjectAIContext; inputFingerprint: string; stale: boolean; validation: ValidationResult }, previousDraft?: string) {
  return prisma.$transaction(async tx => {
    await lockProject(tx, projectId);
    const project = await projectFor(context, projectId, tx);
    const usage = await tx.aIUsage.findUniqueOrThrow({ where: { id: run.runId } });
    if (usage.delivery) return usage.delivery as unknown as Draft;
    if (previousDraft !== undefined && previousDraft !== executionFingerprint(draftsOf(project.aiDrafts)[task] ?? null)) throw new ApiError("AI_DRAFT_CHANGED", "실행 중 기존 검토 초안이 수정되었습니다. 편집 내용은 보존했으며 AI 결과는 사용 기록에 남아 있습니다.", 409, { execution: executionView(usage) });
    const current = await buildProjectAIContext(context, projectId, operations[task], { db: tx });
    const stale = run.stale || current.inputFingerprint !== run.inputFingerprint;
    const draft: Draft & { execution: ReturnType<typeof executionView> } = { ...initialReview(run.context, run.data, run.validation), execution: { ...executionView(usage), state: "COMPLETED" }, revision: project.revision, result: run.data, createdAt: new Date().toISOString(), runId: run.runId, inputFingerprint: run.inputFingerprint, operation: operations[task], context: run.context, issues: reviewIssues(run.context, run.data), status: stale ? "CHANGED" : "READY" };
    if (stale) await tx.aIUsage.update({ where: { id: run.runId }, data: { contextStatus: "CHANGED" } });
    await tx.project.update({ where: { id: projectId }, data: { aiDrafts: jsonValue({ ...draftsOf(project.aiDrafts), [task]: draft }) } });
    await tx.aIUsage.update({ where: { id: run.runId }, data: { delivery: jsonValue(draft) } });
    return draft;
  }, { timeout: 15000 });
}
function validateEstimate(items: z.infer<typeof estimateResultSchema>["items"], ids: string[]) {
  if (items.length !== ids.length || new Set(items.map(i => i.requirementId)).size !== ids.length || items.some(i => !ids.includes(i.requirementId)))
    throw new ApiError("INVALID_ESTIMATE", "모든 확정 요구사항의 작업량을 한 번씩 입력해주세요.", 422);
}

export const aiWorkflowService = {
  async saveReview(context: SessionContext, projectId: string, task: Task, revision: number, candidateRevision: number, value: unknown, warnings: unknown = [], runId?: string) {
    requireOwner(context);
    return prisma.$transaction(async tx => {
      await lockProject(tx, projectId);
      const project = await projectFor(context, projectId, tx); await requireDraft(project, tx);
      const draft = draftsOf(project.aiDrafts)[task];
      if (!draft || draft.revision !== revision || runId && draft.runId !== runId) throw changedContext();
      assertCandidateRevision(draft, candidateRevision);
      const input = await requireFreshAIContext(context, draft, projectId, tx);
      const state = await saveReviewState(tx, context, input, value, draft.result, draft, warnings, {}, { type: "Project", id: projectId, runId: draft.runId });
      const updated = { ...draft, ...state };
      await tx.project.update({ where: { id: projectId }, data: { aiDrafts: jsonValue({ ...draftsOf(project.aiDrafts), [task]: updated }) } });
      return updated;
    }, { timeout: 15000 });
  },
  async saveRequest(context: SessionContext, projectId: string, content: string) {
    requireOwner(context);
    await editDraft(context, projectId, async tx => {
      const previous = await tx.initialRequest.findUnique({ where: { projectId } });
      const history = previous && previous.content !== content ? [...(Array.isArray(previous.history) ? previous.history : []), { content: previous.content, revision: previous.updatedAt.toISOString(), actor: context.userId }] : previous?.history ?? [];
      await tx.initialRequest.upsert({ where: { projectId }, create: { projectId, content }, update: { content, history: jsonValue(history), analysis: Prisma.JsonNull } });
      await markEstimateForReview(tx, projectId);
      await audit(tx, context, "REQUEST_SAVED", "InitialRequest", previous?.id, projectId, { originalPreserved: !!previous });
    });
  },
  async analyzeRequest(context: SessionContext, projectId: string, text: string, regenerate = false, execution: AIExecutionOptions = {}) {
    const previous = executionFingerprint(draftsOf((await ready(context, projectId)).aiDrafts).initial ?? null);
    const initial = await prisma.initialRequest.findUnique({ where: { projectId } });
    // Save the original before calling the provider, including failed requests.
    if (initial?.content !== text) await this.saveRequest(context, projectId, text);
    const result = await generateAI(context, projectId, "INITIAL_ANALYSIS", initialAnalysisSchema.extend({ reviewNotes: reviewNotesSchema }), { regenerate, ...execution });
    return saveDraft(context, projectId, "initial", result, previous);
  },
  async generateQuestions(context: SessionContext, projectId: string, regenerate = false, execution: AIExecutionOptions = {}) {
    const previous = executionFingerprint(draftsOf((await ready(context, projectId)).aiDrafts).questions ?? null);
    const initial = await prisma.initialRequest.findUnique({ where: { projectId } });
    if (!initial?.analysis) throw new ApiError("INITIAL_REVIEW_REQUIRED", "먼저 요청 분석 결과를 검토해 반영해주세요.", 409);
    const answered = await prisma.clarificationQuestion.findMany({ where: { projectId, answer: { isNot: null } }, include: { answer: true } });
    if (answered.length >= 8) throw new ApiError("QUESTION_LIMIT", "질문 8개에 모두 답변이 있습니다. 요구사항을 정리해주세요.", 409);
    const result = await generateAI(context, projectId, "QUESTIONS", questionsResultSchema.extend({ reviewNotes: reviewNotesSchema }), { regenerate, model: "fast", ...execution });
    return saveDraft(context, projectId, "questions", result, previous);
  },
  async generateRequirements(context: SessionContext, projectId: string, regenerate = false, execution: AIExecutionOptions = {}) {
    const previous = executionFingerprint(draftsOf((await ready(context, projectId)).aiDrafts).requirements ?? null);
    const initial = await prisma.initialRequest.findUnique({ where: { projectId } });
    if (!initial) throw new ApiError("INITIAL_REQUEST_REQUIRED", "고객 원문 요청이 필요합니다.", 409);
    const result = await generateAI(context, projectId, "REQUIREMENTS", requirementsResultSchema.extend({ reviewNotes: reviewNotesSchema }), { regenerate, ...execution });
    return saveDraft(context, projectId, "requirements", result, previous);
  },
  async estimate(context: SessionContext, projectId: string, regenerate = false, execution: AIExecutionOptions = {}) {
    const previous = executionFingerprint(draftsOf((await ready(context, projectId)).aiDrafts).estimate ?? null);
    const requirements = await prisma.requirement.findMany({ where: { projectId, status: "CONFIRMED" }, orderBy: { createdAt: "asc" } });
    if (!requirements.length) throw new ApiError("REQUIREMENTS_REQUIRED", "요구사항을 먼저 확정해주세요.", 409);
    if (!await prisma.rateCard.count({ where: { workspaceId: context.workspaceId } })) throw new ApiError("RATES_REQUIRED", "설정에서 작업 단가를 먼저 저장해주세요.", 409);
    const result = await generateAI(context, projectId, "ESTIMATE", estimateResultSchema.extend({ reviewNotes: reviewNotesSchema }), { regenerate, ...execution });
    return saveDraft(context, projectId, "estimate", result, previous);
  },
  async summarize(context: SessionContext, projectId: string, regenerate = false, execution: AIExecutionOptions = {}) {
    const previous = executionFingerprint(draftsOf((await ready(context, projectId)).aiDrafts).summary ?? null);
    const input = await buildProjectAIContext(context, projectId, "SCOPE_SUMMARY");
    if (!input.confirmedEstimate?.reviewed || !input.confirmedRequirements.length || input.confirmedRequirements.some(r => !input.confirmedEstimate?.items.some(i => i.requirementId === r.id))) throw new ApiError("ESTIMATE_REVIEW_REQUIRED", "저장된 요구사항과 작업량을 먼저 검토해주세요.", 409);
    return saveDraft(context, projectId, "summary", await generateAI(context, projectId, "SCOPE_SUMMARY", scopeAIResultSchema.extend({ reviewNotes: reviewNotesSchema }), { regenerate, ...execution }), previous);
  },
  async apply(context: SessionContext, projectId: string, task: Task, revision: number, value: unknown, options: { resolutions?: unknown; reason?: string; runId?: string; candidateRevision?: number; durationDays?: number } = {}) {
    requireOwner(context);
    if (task === "summary") { const { scopeService } = await import("./workflow.service"); return scopeService.applyAI(context, projectId, revision, value, options); }
    await editDraft(context, projectId, async (tx, project) => {
      const draft = draftsOf(project.aiDrafts)[task];
      if (!draft || draft.revision !== revision || (options.runId && options.runId !== draft.runId)) throw new ApiError("AI_CONTEXT_CHANGED", "이전 결과입니다. 최신 AI 초안을 다시 검토해주세요.", 409);
      assertCandidateRevision(draft, options.candidateRevision);
      const input = await requireFreshAIContext(context, draft, projectId, tx);
      const structure = revalidate(input, value, draft);
      if (structure.issues.some(i => i.severity === "ERROR" && ["RV-001", "RV-002"].includes(i.ruleId))) requireValidated(structure);
      const result = schemas[task].parse(value);
      validateContextResult(result, input);
      await recordAIReview(tx, context, input, result, draft.result, options.resolutions, options.reason, draft.runId);
      const current = await buildProjectAIContext(context, projectId, operations[task], { db: tx });
      const validation = revalidate(current, result, draft); requireValidated(validation);
      await saveReviewState(tx, context, current, result, draft.result, draft, [], {}, { type: "Project", id: projectId, runId: draft.runId });
      await auditValidation(tx, context, current, result, validation, draft, "Project", projectId);
      if ("projectType" in result) {
        await tx.initialRequest.update({ where: { projectId }, data: { analysis: jsonValue(result) } });
        await markEstimateForReview(tx, projectId);
      } else if ("questions" in result) {
        const answered = await tx.clarificationQuestion.count({ where: { projectId, answer: { isNot: null } } });
        if (result.questions.length + answered > 8) throw new ApiError("QUESTION_LIMIT", "답변된 질문을 포함해 최대 8개입니다.", 422);
        const existing = await tx.clarificationQuestion.findMany({ where: { projectId } });
        const additions = result.questions.filter(q => !existing.some(e => e.question.trim() === q.question.trim()));
        if (existing.length + additions.length > 8) throw new ApiError("QUESTION_LIMIT", "기존 질문과 새 질문은 합계 최대 8개입니다.", 422);
        await tx.clarificationQuestion.createMany({ data: additions.map((q, i) => ({ question: q.question, reason: q.reason, important: q.important, projectId, position: existing.length + i })) });
        await markEstimateForReview(tx, projectId);
      } else if ("requirements" in result) {
        const touched = new Set<string>();
        for (const r of result.requirements) {
          const fields = requirementInputSchema.parse(r);
          const provenance = jsonValue({ sourceRefs: r.sourceRefs, implementation: r.implementation ?? null, reviewedBy: context.userId, runId: draft.runId, reason: options.reason ?? "AI 근거 검토 후 반영", customerApproved: false });
          if (r.existingRequirementId) {
            if (touched.has(r.existingRequirementId)) throw new ApiError("INVALID_REQUIREMENTS", "같은 요구사항에 여러 변경을 반영할 수 없습니다.", 422);
            touched.add(r.existingRequirementId);
            const existing = await tx.requirement.findFirst({ where: { id: r.existingRequirementId, projectId } });
            if (!existing) throw new ApiError("INVALID_REQUIREMENTS", "수정할 요구사항을 찾을 수 없습니다.", 422);
            if (r.change !== "KEEP") await tx.requirement.update({ where: { id: existing.id }, data: { ...fields, provenance, status: r.change === "REMOVE" ? "EXCLUDED" : "CONFIRMED" } });
          } else {
            if (r.change !== "ADD") throw new ApiError("INVALID_REQUIREMENTS", "신규 항목은 추가 제안으로 반영해주세요.", 422);
            await tx.requirement.create({ data: { ...fields, projectId, provenance, source: r.sourceRefs.some(id => id.startsWith("answer:")) ? "CLIENT_ANSWER" : "CLIENT_INITIAL", status: "CONFIRMED" } });
          }
        }
        await markEstimateForReview(tx, projectId);
      } else {
        const requirements = await tx.requirement.findMany({ where: { projectId, status: "CONFIRMED" } });
        validateEstimate(result.items, requirements.map(r => r.id));
        const card = await tx.rateCard.findUnique({ where: { workspaceId: context.workspaceId } });
        if (!card) throw new ApiError("RATES_REQUIRED", "작업 단가를 설정해주세요.", 409);
        const estimate = await tx.estimate.upsert({ where: { projectId }, create: { projectId, rates: card.rates as Prisma.InputJsonValue }, update: {} });
        for (const i of result.items) await tx.estimateItem.upsert({ where: { estimateId_requirementId: { estimateId: estimate.id, requirementId: i.requirementId } }, create: { requirementId: i.requirementId, estimateId: estimate.id, hours: jsonValue(i.hours), implementation: i.implementation ? jsonValue(i.implementation) : Prisma.JsonNull, complexity: i.complexity, reason: i.reason, reviewed: true }, update: { hours: jsonValue(i.hours), implementation: i.implementation ? jsonValue(i.implementation) : Prisma.JsonNull, complexity: i.complexity, reason: i.reason, reviewed: true } });
      }
      const remaining = { ...draftsOf(project.aiDrafts) };
      delete remaining[task];
      await tx.project.update({ where: { id: projectId }, data: { aiDrafts: jsonValue(remaining) } });
      await audit(tx, context, "AI_DRAFT_APPLIED", "Project", projectId, projectId, { task, runId: draft.runId, ...("requirements" in result ? { count: result.requirements.length } : {}) });
    });
  },
  async getEstimate(context: SessionContext, projectId: string) {
    await projectFor(context, projectId);
    const estimate = await prisma.estimate.findUnique({ where: { projectId }, include: { items: { include: { requirement: { select: { title: true } } } } } });
    if (!estimate) return null;
    const rates = ratesSchema.parse(estimate.rates);
    const items = estimate.items.map(item => ({ ...item, hours: hoursSchema.parse(item.hours), amount: calculateAmount(hoursSchema.parse(item.hours), rates) }));
    const subtotal = items.reduce((sum, item) => sum + item.amount, 0);
    return { ...estimate, rates, items, subtotal, total: estimate.overrideTotal ?? subtotal };
  },
  async updateEstimate(context: SessionContext, projectId: string, input: { items?: { requirementId: string; hours: z.infer<typeof hoursSchema>; implementation?: unknown; complexity: string; reason: string; reviewed?: boolean }[]; overrideTotal?: number | null; adjustmentReason?: string; warnings?: unknown; candidateRevision?: number; candidate?: unknown }) {
    requireOwner(context);
    if (input.overrideTotal != null && !input.adjustmentReason?.trim()) throw new ApiError("ADJUSTMENT_REASON_REQUIRED", "견적 조정 사유를 입력해주세요.", 422, { fieldErrors: [{ fieldPath: "adjustmentReason", message: "견적 조정 사유를 입력해주세요." }] });
    await editDraft(context, projectId, async tx => {
      const card = await tx.rateCard.findUnique({ where: { workspaceId: context.workspaceId } });
      if (!card) throw new ApiError("RATES_REQUIRED", "작업 단가를 먼저 설정해주세요.", 409);
      const estimate = await tx.estimate.upsert({ where: { projectId }, create: { projectId, rates: card.rates as Prisma.InputJsonValue }, update: {} });
      const savedItems = await tx.estimateItem.findMany({ where: { estimateId: estimate.id } });
      const previous = estimate.validationReview as Partial<ReviewState> | null;
      if (input.candidateRevision !== undefined) assertCandidateRevision(previous, input.candidateRevision);
      const current = await buildProjectAIContext(context, projectId, "ESTIMATE", { db: tx });
      const original = { items: savedItems.map(i => ({ requirementId: i.requirementId, hours: i.hours, implementation: i.implementation, complexity: i.complexity, reason: i.reason })) };
      const priorItems = (previous?.candidate as { items?: typeof input.items } | undefined)?.items;
      const proposed = input.candidate ?? { items: current.confirmedRequirements.map(r => {
        const item = input.items?.find(i => i.requirementId === r.id) ?? priorItems?.find(i => i.requirementId === r.id) ?? savedItems.find(i => i.requirementId === r.id);
        return item ? { requirementId: r.id, hours: item.hours, implementation: item.implementation ?? (r.provenance as { implementation?: unknown }).implementation, complexity: item.complexity, reason: item.reason } : { requirementId: r.id };
      }), overrideTotal: input.overrideTotal === undefined ? estimate.overrideTotal : input.overrideTotal, adjustmentReason: input.adjustmentReason ?? estimate.adjustmentReason };
      const parsed = estimateResultSchema.safeParse(proposed);
      const calculated = parsed.success ? parsed.data.items.reduce((sum, i) => sum + calculateAmount(i.hours, ratesSchema.parse(estimate.rates)), 0) : 0;
      const values = (proposed && typeof proposed === "object" ? proposed : {}) as { overrideTotal?: number | null; adjustmentReason?: string };
      const policy: ValidationPolicy = { kind: "ESTIMATE", amounts: { calculated, final: values.overrideTotal ?? calculated, adjustmentReason: values.adjustmentReason ?? "" } };
      const state = await saveReviewState(tx, context, current, proposed, original, previous, input.warnings, policy, { type: "Estimate", id: estimate.id });
      await tx.estimate.update({ where: { id: estimate.id }, data: { validationReview: jsonValue(state) } });
      if (!["passed", "passed_with_warnings"].includes(state.validation.status)) return;
      input.items = parsed.success ? parsed.data.items : input.items;
      input.overrideTotal = values.overrideTotal; input.adjustmentReason = values.adjustmentReason;
      await tx.estimate.update({ where: { id: estimate.id }, data: { overrideTotal: input.overrideTotal, adjustmentReason: input.adjustmentReason } });
      for (const item of input.items ?? []) {
        if (!await tx.requirement.count({ where: { id: item.requirementId, projectId, status: "CONFIRMED" } })) throw new ApiError("INVALID_REQUIREMENT", "확정된 요구사항만 견적에 포함할 수 있습니다.", 422);
        const data = { hours: jsonValue(item.hours), ...(item.implementation !== undefined ? { implementation: jsonValue(item.implementation) } : {}), complexity: item.complexity, reason: item.reason, reviewed: item.reviewed ?? true };
        await tx.estimateItem.upsert({ where: { estimateId_requirementId: { estimateId: estimate.id, requirementId: item.requirementId } }, create: { ...data, estimateId: estimate.id, requirementId: item.requirementId }, update: data });
      }
      await audit(tx, context, "ESTIMATE_UPDATED", "Estimate", estimate.id, projectId, { source: "MANUAL" });
    });
    return this.getEstimate(context, projectId);
  },
  async compareChange(context: SessionContext, projectId: string, changeId: string, regenerate = false, execution: AIExecutionOptions = {}) {
    requireOwner(context);
    const project = await projectFor(context, projectId); requireEditable(project.status);
    const change = await prisma.changeRequest.findFirst({ where: { id: changeId, projectId }, include: { baseScope: { include: { requirements: true } } } });
    if (!change || !["DRAFT", "WAITING_INTERNAL_REVIEW"].includes(change.status)) throw new ApiError("CHANGE_NOT_ANALYZABLE", "분석할 수 있는 변경 요청이 아닙니다.", 409);
    const run = await generateAI(context, projectId, "SCOPE_COMPARISON", comparisonSchema.extend({ reviewNotes: reviewNotesSchema }), { regenerate, model: "reasoning", changeId, ...execution });
    const analysis = run.data;
    return prisma.$transaction(async tx => {
      await lockProject(tx, projectId);
      requireEditable((await projectFor(context, projectId, tx)).status);
      const current = await tx.changeRequest.findUnique({ where: { id: changeId } });
      const usage = await tx.aIUsage.findUniqueOrThrow({ where: { id: run.runId } });
      if (usage.delivery) return usage.delivery as unknown as typeof change;
      if (!current || !["DRAFT", "WAITING_INTERNAL_REVIEW"].includes(current.status)) throw changedContext();
      if (current.revision !== change.revision && executionFingerprint(current.analysisContext) !== executionFingerprint(change.analysisContext)) throw new ApiError("AI_DRAFT_CHANGED", "실행 중 변경 검토 초안이 수정되었습니다. 편집 내용은 보존했습니다.", 409, { execution: executionView(usage) });
      const input = await buildProjectAIContext(context, projectId, "SCOPE_COMPARISON", { db: tx, changeId });
      const stale = run.stale || input.inputFingerprint !== run.inputFingerprint;
      if (stale) await tx.aIUsage.update({ where: { id: run.runId }, data: { contextStatus: "CHANGED" } });
      const hours = hoursSchema.safeParse(analysis?.estimatedWork);
      const delivered = await tx.changeRequest.update({ where: { id: change.id }, data: { analysis: analysis === null ? Prisma.JsonNull : jsonValue(analysis), analysisContext: jsonValue({ ...initialReview(run.context, analysis, run.validation), execution: { ...executionView(usage), state: "COMPLETED" }, inputFingerprint: run.inputFingerprint, operation: "SCOPE_COMPARISON", changeId, context: run.context, issues: reviewIssues(run.context, analysis), runId: run.runId, status: stale ? "CHANGED" : "READY" }), review: analysis === null ? Prisma.JsonNull : jsonValue(analysis), reviewedBy: null, ...(hours.success ? { amount: calculateAmount(hours.data, ratesSchema.parse(change.rates)) } : {}), status: "WAITING_INTERNAL_REVIEW", revision: { increment: 1 } } });
      await tx.aIUsage.update({ where: { id: run.runId }, data: { delivery: jsonValue({ ...delivered, runId: run.runId }) } });
      return delivered;
    }, { timeout: 15000 });
  },
};
