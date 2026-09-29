import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/errors";
import type { SessionContext } from "@/lib/auth/session";
import { requireEditable, requireOwner } from "@/lib/auth/permissions";
import { calculateAmount, comparisonSchema, estimateResultSchema, hoursSchema, initialAnalysisSchema, questionsResultSchema, requirementsResultSchema, ratesSchema } from "@/lib/model";
import { generateAI } from "@/lib/ai/ai.service";
import { audit, editDraft, lockProject, projectFor, requireDraft } from "./shared";

const jsonValue = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
type Task = "initial" | "questions" | "requirements" | "estimate";
const schemas = { initial: initialAnalysisSchema, questions: questionsResultSchema, requirements: requirementsResultSchema, estimate: estimateResultSchema };
type Draft = { revision: number; result: unknown; createdAt: string };
const draftsOf = (value: Prisma.JsonValue) => value as unknown as Partial<Record<Task, Draft>>;

async function ready(context: SessionContext, projectId: string) {
  requireOwner(context);
  const project = await projectFor(context, projectId);
  await requireDraft(project);
  return project;
}
async function saveDraft(context: SessionContext, projectId: string, revision: number, task: Task, result: unknown) {
  return prisma.$transaction(async tx => {
    await lockProject(tx, projectId);
    const project = await projectFor(context, projectId, tx);
    await requireDraft(project, tx);
    if (project.revision !== revision) throw new ApiError("AI_DRAFT_STALE", "분석 중 입력이 변경되었습니다. 다시 분석해주세요.", 409);
    const draft = { revision, result, createdAt: new Date().toISOString() };
    await tx.project.update({ where: { id: projectId }, data: { aiDrafts: jsonValue({ ...draftsOf(project.aiDrafts), [task]: draft }) } });
    return draft;
  });
}
function validateEstimate(items: z.infer<typeof estimateResultSchema>["items"], ids: string[]) {
  if (items.length !== ids.length || new Set(items.map(i => i.requirementId)).size !== ids.length || items.some(i => !ids.includes(i.requirementId)))
    throw new ApiError("INVALID_ESTIMATE", "모든 확정 요구사항의 작업량을 한 번씩 입력해주세요.", 422);
}

export const aiWorkflowService = {
  async saveRequest(context: SessionContext, projectId: string, content: string) {
    requireOwner(context);
    await editDraft(context, projectId, async tx => {
      await tx.initialRequest.upsert({ where: { projectId }, create: { projectId, content }, update: { content, analysis: Prisma.JsonNull } });
      await tx.requirement.updateMany({ where: { projectId, status: "CONFIRMED" }, data: { status: "PENDING" } });
    });
  },
  async analyzeRequest(context: SessionContext, projectId: string, text: string, regenerate = false) {
    await ready(context, projectId);
    const initial = await prisma.initialRequest.findUnique({ where: { projectId } });
    // Save the original before calling the provider, including failed requests.
    if (initial?.content !== text) await this.saveRequest(context, projectId, text);
    const project = await ready(context, projectId);
    const result = await generateAI(context, projectId, "INITIAL_ANALYSIS", { project: { name: project.name, budget: project.budget, deadline: project.deadline }, request: text }, initialAnalysisSchema, { regenerate });
    return saveDraft(context, projectId, project.revision, "initial", result);
  },
  async generateQuestions(context: SessionContext, projectId: string, regenerate = false) {
    const project = await ready(context, projectId);
    const initial = await prisma.initialRequest.findUnique({ where: { projectId } });
    if (!initial?.analysis) throw new ApiError("INITIAL_REVIEW_REQUIRED", "먼저 요청 분석 결과를 검토해 반영해주세요.", 409);
    const answered = await prisma.clarificationQuestion.findMany({ where: { projectId, answer: { isNot: null } }, include: { answer: true } });
    if (answered.length >= 8) throw new ApiError("QUESTION_LIMIT", "질문 8개에 모두 답변이 있습니다. 요구사항을 정리해주세요.", 409);
    const result = await generateAI(context, projectId, "QUESTIONS", { request: initial.content, analysis: initial.analysis, answered, maxQuestions: 8 - answered.length }, questionsResultSchema, { regenerate, model: "fast" });
    return saveDraft(context, projectId, project.revision, "questions", result);
  },
  async generateRequirements(context: SessionContext, projectId: string, regenerate = false) {
    const project = await ready(context, projectId);
    const [initial, questions] = await Promise.all([prisma.initialRequest.findUnique({ where: { projectId } }), prisma.clarificationQuestion.findMany({ where: { projectId }, include: { answer: true }, orderBy: { position: "asc" } })]);
    if (!initial) throw new ApiError("INITIAL_REQUEST_REQUIRED", "고객 원문 요청이 필요합니다.", 409);
    if (questions.some(q => !q.answer)) throw new ApiError("ANSWERS_REQUIRED", "고객 답변을 입력하거나 불필요한 질문을 삭제해주세요.", 409);
    const result = await generateAI(context, projectId, "REQUIREMENTS", { request: initial.content, analysis: initial.analysis, clarifications: questions.map(({ question, answer }) => ({ question, answer: answer?.content })) }, requirementsResultSchema, { regenerate });
    return saveDraft(context, projectId, project.revision, "requirements", result);
  },
  async estimate(context: SessionContext, projectId: string, regenerate = false) {
    const project = await ready(context, projectId);
    const requirements = await prisma.requirement.findMany({ where: { projectId, status: { not: "EXCLUDED" } }, orderBy: { createdAt: "asc" } });
    if (!requirements.length || requirements.some(r => r.status !== "CONFIRMED")) throw new ApiError("REQUIREMENTS_REQUIRED", "요구사항을 먼저 확정해주세요.", 409);
    if (await prisma.clarificationQuestion.count({ where: { projectId, answer: null } })) throw new ApiError("ANSWERS_REQUIRED", "고객 답변을 먼저 확인해주세요.", 409);
    if (!await prisma.rateCard.count({ where: { workspaceId: context.workspaceId } })) throw new ApiError("RATES_REQUIRED", "설정에서 작업 단가를 먼저 저장해주세요.", 409);
    const result = await generateAI(context, projectId, "ESTIMATE", { requirements }, estimateResultSchema, { regenerate });
    validateEstimate(result.items, requirements.map(r => r.id));
    return saveDraft(context, projectId, project.revision, "estimate", result);
  },
  async apply(context: SessionContext, projectId: string, task: Task, revision: number, value: unknown) {
    requireOwner(context);
    await editDraft(context, projectId, async (tx, project) => {
      const draft = draftsOf(project.aiDrafts)[task];
      if (!draft || draft.revision !== revision || project.revision !== revision) throw new ApiError("AI_DRAFT_STALE", "입력이 변경된 이전 결과입니다. 다시 분석해주세요.", 409);
      const result = schemas[task].parse(value);
      if ("projectType" in result) {
        await tx.initialRequest.update({ where: { projectId }, data: { analysis: jsonValue(result) } });
      } else if ("questions" in result) {
        const answered = await tx.clarificationQuestion.count({ where: { projectId, answer: { isNot: null } } });
        if (result.questions.length + answered > 8) throw new ApiError("QUESTION_LIMIT", "답변된 질문을 포함해 최대 8개입니다.", 422);
        await tx.clarificationQuestion.deleteMany({ where: { projectId, answer: null } });
        await tx.clarificationQuestion.createMany({ data: result.questions.map((q, i) => ({ ...q, projectId, position: answered + i })) });
        await tx.clientAccessToken.updateMany({ where: { projectId, purpose: "QUESTIONS", revokedAt: null }, data: { revokedAt: new Date() } });
      } else if ("requirements" in result) {
        await tx.scopeRequirement.deleteMany({ where: { scope: { projectId, status: "DRAFT" } } });
        await tx.requirement.deleteMany({ where: { projectId } });
        await tx.requirement.createMany({ data: result.requirements.map(r => ({ ...r, projectId, source: "CLIENT_INITIAL", status: "CONFIRMED" })) });
      } else {
        const requirements = await tx.requirement.findMany({ where: { projectId, status: "CONFIRMED" } });
        validateEstimate(result.items, requirements.map(r => r.id));
        const card = await tx.rateCard.findUnique({ where: { workspaceId: context.workspaceId } });
        if (!card) throw new ApiError("RATES_REQUIRED", "작업 단가를 설정해주세요.", 409);
        const estimate = await tx.estimate.upsert({ where: { projectId }, create: { projectId, rates: card.rates as Prisma.InputJsonValue }, update: { rates: card.rates as Prisma.InputJsonValue, overrideTotal: null, adjustmentReason: "" } });
        await tx.estimateItem.deleteMany({ where: { estimateId: estimate.id } });
        await tx.estimateItem.createMany({ data: result.items.map(i => ({ ...i, hours: jsonValue(i.hours), estimateId: estimate.id, reviewed: true })) });
      }
      const remaining = { ...draftsOf(project.aiDrafts) };
      delete remaining[task];
      await tx.project.update({ where: { id: projectId }, data: { aiDrafts: jsonValue(remaining) } });
      await audit(tx, context, "AI_DRAFT_APPLIED", "Project", projectId, projectId, { task });
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
  async updateEstimate(context: SessionContext, projectId: string, input: { items?: { requirementId: string; hours: z.infer<typeof hoursSchema>; complexity: string; reason: string; reviewed?: boolean }[]; overrideTotal?: number | null; adjustmentReason?: string }) {
    requireOwner(context);
    if (input.overrideTotal != null && !input.adjustmentReason?.trim()) throw new ApiError("ADJUSTMENT_REASON_REQUIRED", "금액 조정 이유가 필요합니다.", 422);
    await editDraft(context, projectId, async tx => {
      const card = await tx.rateCard.findUnique({ where: { workspaceId: context.workspaceId } });
      if (!card) throw new ApiError("RATES_REQUIRED", "작업 단가를 먼저 설정해주세요.", 409);
      const estimate = await tx.estimate.upsert({ where: { projectId }, create: { projectId, rates: card.rates as Prisma.InputJsonValue }, update: {} });
      await tx.estimate.update({ where: { id: estimate.id }, data: { overrideTotal: input.overrideTotal, adjustmentReason: input.adjustmentReason } });
      for (const item of input.items ?? []) {
        if (!await tx.requirement.count({ where: { id: item.requirementId, projectId, status: "CONFIRMED" } })) throw new ApiError("INVALID_REQUIREMENT", "확정된 요구사항만 견적에 포함할 수 있습니다.", 422);
        const data = { hours: jsonValue(item.hours), complexity: item.complexity, reason: item.reason, reviewed: item.reviewed ?? true };
        await tx.estimateItem.upsert({ where: { estimateId_requirementId: { estimateId: estimate.id, requirementId: item.requirementId } }, create: { ...data, estimateId: estimate.id, requirementId: item.requirementId }, update: data });
      }
      await audit(tx, context, "ESTIMATE_UPDATED", "Estimate", estimate.id, projectId, { source: "MANUAL" });
    });
    return this.getEstimate(context, projectId);
  },
  async compareChange(context: SessionContext, projectId: string, changeId: string, regenerate = false) {
    requireOwner(context);
    const project = await projectFor(context, projectId); requireEditable(project.status);
    const change = await prisma.changeRequest.findFirst({ where: { id: changeId, projectId }, include: { baseScope: { include: { requirements: true } } } });
    if (!change || !["DRAFT", "WAITING_INTERNAL_REVIEW"].includes(change.status)) throw new ApiError("CHANGE_NOT_ANALYZABLE", "분석할 수 있는 변경 요청이 아닙니다.", 409);
    const analysis = await generateAI(context, projectId, "SCOPE_COMPARISON", { request: change.request, scope: change.baseScope.document, requirementSnapshots: change.baseScope.requirements.map(item => item.snapshot) }, comparisonSchema, { regenerate, model: "reasoning" });
    const requirementIds = new Set(change.baseScope.requirements.map(item => item.requirementId));
    const excluded = (change.baseScope.document as { excluded?: string[] }).excluded ?? [];
    if (analysis.affectedExistingRequirements.some(id => !requirementIds.has(id)) || analysis.removedExclusions.some(item => !excluded.includes(item))) throw new ApiError("AI_INVALID_RESPONSE", "현재 Scope에 없는 항목이 포함되어 있습니다.", 502);
    return prisma.$transaction(async tx => {
      await lockProject(tx, projectId);
      requireEditable((await projectFor(context, projectId, tx)).status);
      const current = await tx.changeRequest.findUnique({ where: { id: changeId } });
      if (current?.revision !== change.revision || !["DRAFT", "WAITING_INTERNAL_REVIEW"].includes(current.status)) throw new ApiError("AI_DRAFT_STALE", "분석 중 변경 요청이 수정되었습니다. 다시 분석해주세요.", 409);
      return tx.changeRequest.update({ where: { id: change.id }, data: { analysis: jsonValue(analysis), review: jsonValue(analysis), reviewedBy: null, amount: calculateAmount(analysis.estimatedWork, ratesSchema.parse(change.rates)), status: "WAITING_INTERNAL_REVIEW", revision: { increment: 1 } } });
    });
  },
};
