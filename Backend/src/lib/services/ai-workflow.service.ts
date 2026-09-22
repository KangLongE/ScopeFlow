import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/errors";
import type { SessionContext } from "@/lib/auth/session";
import { calculateAmount, comparisonSchema, estimateResultSchema, initialAnalysisSchema, questionsResultSchema, requirementsResultSchema, ratesSchema } from "@/lib/model";
import { generateAI } from "@/lib/ai/ai.service";
import { audit, projectFor } from "./shared";

const jsonValue = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

export const aiWorkflowService = {
  async analyzeRequest(context: SessionContext, projectId: string, text: string, regenerate = false) {
    const project = await projectFor(context, projectId);
    const analysis = await generateAI(context, projectId, "INITIAL_ANALYSIS", { project: { name: project.name, budget: project.budget, deadline: project.deadline }, request: text }, initialAnalysisSchema, { regenerate });
    await prisma.initialRequest.upsert({ where: { projectId }, create: { projectId, content: text, analysis: jsonValue(analysis) }, update: { content: text, analysis: jsonValue(analysis) } });
    return analysis;
  },
  async generateQuestions(context: SessionContext, projectId: string, regenerate = false) {
    await projectFor(context, projectId);
    const initial = await prisma.initialRequest.findUnique({ where: { projectId } });
    if (!initial) throw new ApiError("INITIAL_REQUEST_REQUIRED", "먼저 최초 요청을 분석해주세요.", 409);
    const result = await generateAI(context, projectId, "QUESTIONS", { request: initial.content, analysis: initial.analysis }, questionsResultSchema, { regenerate, model: "fast" });
    await prisma.$transaction(async (tx) => {
      await tx.clarificationQuestion.deleteMany({ where: { projectId, answer: null } });
      await tx.clarificationQuestion.createMany({ data: result.questions.map((question, position) => ({ projectId, ...question, position })) });
    });
    return prisma.clarificationQuestion.findMany({ where: { projectId }, include: { answer: true }, orderBy: { position: "asc" } });
  },
  async generateRequirements(context: SessionContext, projectId: string, regenerate = false) {
    await projectFor(context, projectId);
    const [initial, questions] = await Promise.all([prisma.initialRequest.findUnique({ where: { projectId } }), prisma.clarificationQuestion.findMany({ where: { projectId }, include: { answer: true }, orderBy: { position: "asc" } })]);
    if (!initial) throw new ApiError("INITIAL_REQUEST_REQUIRED", "먼저 최초 요청을 분석해주세요.", 409);
    const result = await generateAI(context, projectId, "REQUIREMENTS", { request: initial.content, analysis: initial.analysis, clarifications: questions.map(({ question, answer }) => ({ question, answer: answer?.content ?? null })) }, requirementsResultSchema, { regenerate });
    await prisma.$transaction(async (tx) => {
      if (await tx.scope.count({ where: { projectId, status: { in: ["WAITING_APPROVAL", "APPROVED"] } } })) throw new ApiError("SCOPE_FROZEN", "승인 절차가 시작된 프로젝트의 요구사항은 자동 교체할 수 없습니다.", 409);
      await tx.requirement.deleteMany({ where: { projectId } });
      await tx.requirement.createMany({ data: result.requirements.map((item) => ({ ...item, projectId, source: "CLIENT_INITIAL" as const })) });
      await tx.project.update({ where: { id: projectId }, data: { revision: { increment: 1 } } });
    });
    return prisma.requirement.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } });
  },
  async estimate(context: SessionContext, projectId: string, regenerate = false) {
    await projectFor(context, projectId);
    const requirements = await prisma.requirement.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } });
    if (!requirements.length) throw new ApiError("REQUIREMENTS_REQUIRED", "견적 전에 요구사항이 필요합니다.", 409);
    const result = await generateAI(context, projectId, "ESTIMATE", { requirements: requirements.map(({ id, category, title, description, type, priority }) => ({ id, category, title, description, type, priority })) }, estimateResultSchema, { regenerate });
    if (result.items.some((item) => !requirements.some((requirement) => requirement.id === item.requirementId))) throw new ApiError("AI_INVALID_RESPONSE", "AI가 존재하지 않는 요구사항을 참조했습니다.", 502);
    const card = await prisma.rateCard.findUnique({ where: { workspaceId: context.workspaceId } });
    const rates = ratesSchema.parse(card?.rates);
    await prisma.$transaction(async (tx) => {
      const estimate = await tx.estimate.upsert({ where: { projectId }, create: { projectId, rates: jsonValue(rates) }, update: { rates: jsonValue(rates), overrideTotal: null, adjustmentReason: "" } });
      await tx.estimateItem.deleteMany({ where: { estimateId: estimate.id } });
      await tx.estimateItem.createMany({ data: result.items.map((item) => ({ estimateId: estimate.id, requirementId: item.requirementId, hours: jsonValue(item.hours), complexity: item.complexity, reason: item.reason })) });
      await audit(tx, context, "ESTIMATE_UPDATED", "Estimate", estimate.id, projectId, { source: "AI" });
    });
    return this.getEstimate(context, projectId);
  },
  async getEstimate(context: SessionContext, projectId: string) {
    await projectFor(context, projectId);
    const estimate = await prisma.estimate.findUnique({ where: { projectId }, include: { items: { include: { requirement: { select: { title: true } } } } } });
    if (!estimate) return null;
    const rates = ratesSchema.parse(estimate.rates);
    const items = estimate.items.map((item) => ({ ...item, hours: z.parse(z.object({ frontend: z.number(), backend: z.number(), design: z.number(), qa: z.number() }), item.hours), amount: calculateAmount(z.parse(z.object({ frontend: z.number(), backend: z.number(), design: z.number(), qa: z.number() }), item.hours), rates) }));
    const subtotal = items.reduce((sum, item) => sum + item.amount, 0);
    return { ...estimate, rates, items, subtotal, total: estimate.overrideTotal ?? subtotal };
  },
  async updateEstimate(context: SessionContext, projectId: string, input: { items?: { requirementId: string; hours: { frontend: number; backend: number; design: number; qa: number }; complexity: string; reason: string; reviewed?: boolean }[]; overrideTotal?: number | null; adjustmentReason?: string }) {
    await projectFor(context, projectId);
    const estimate = await prisma.estimate.findUnique({ where: { projectId } });
    if (!estimate) throw new ApiError("ESTIMATE_NOT_FOUND", "견적을 먼저 생성해주세요.", 404);
    if (input.overrideTotal != null && !input.adjustmentReason?.trim()) throw new ApiError("ADJUSTMENT_REASON_REQUIRED", "금액 조정 이유가 필요합니다.", 422);
    await prisma.$transaction(async (tx) => {
      await tx.estimate.update({ where: { id: estimate.id }, data: { overrideTotal: input.overrideTotal, adjustmentReason: input.adjustmentReason } });
      for (const item of input.items ?? []) await tx.estimateItem.updateMany({ where: { estimateId: estimate.id, requirementId: item.requirementId }, data: { hours: jsonValue(item.hours), complexity: item.complexity, reason: item.reason, reviewed: item.reviewed ?? true } });
      await audit(tx, context, "ESTIMATE_UPDATED", "Estimate", estimate.id, projectId, { source: "MANUAL" });
    });
    return this.getEstimate(context, projectId);
  },
  async compareChange(context: SessionContext, projectId: string, changeId: string, regenerate = false) {
    await projectFor(context, projectId);
    const change = await prisma.changeRequest.findFirst({ where: { id: changeId, projectId }, include: { baseScope: { include: { requirements: true } } } });
    if (!change || !["DRAFT", "WAITING_INTERNAL_REVIEW"].includes(change.status)) throw new ApiError("CHANGE_NOT_ANALYZABLE", "분석할 수 있는 변경 요청이 아닙니다.", 409);
    const analysis = await generateAI(context, projectId, "SCOPE_COMPARISON", { request: change.request, scope: change.baseScope.document, requirementSnapshots: change.baseScope.requirements.map((item) => item.snapshot) }, comparisonSchema, { regenerate, model: "reasoning" });
    const requirementIds = new Set(change.baseScope.requirements.map((item) => item.requirementId));
    const document = change.baseScope.document as { excluded?: unknown };
    const excluded = Array.isArray(document.excluded) ? document.excluded.filter((item): item is string => typeof item === "string") : [];
    if (analysis.affectedExistingRequirements.some((id) => !requirementIds.has(id)) || analysis.removedExclusions.some((item) => !excluded.includes(item))) throw new ApiError("AI_INVALID_RESPONSE", "AI가 현재 Scope에 없는 항목을 참조했습니다.", 502);
    if (analysis.classification === "IN_SCOPE" && (analysis.newRequirements.length || Object.values(analysis.estimatedWork).some(Boolean) || analysis.scheduleImpactDays)) throw new ApiError("AI_INVALID_RESPONSE", "기존 범위 요청에 추가 작업이 포함되어 있습니다.", 502);
    const amount = calculateAmount(analysis.estimatedWork, ratesSchema.parse(change.rates));
    return prisma.changeRequest.update({ where: { id: change.id }, data: { analysis: jsonValue(analysis), review: jsonValue(analysis), amount, status: "WAITING_INTERNAL_REVIEW", revision: { increment: 1 } } });
  },
};
