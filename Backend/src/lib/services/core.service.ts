import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { activities } from "./activity.service";
import { ApiError, notFound } from "@/lib/errors";
import { requireOwner } from "@/lib/auth/permissions";
import type { SessionContext } from "@/lib/auth/session";
import { audit, editDraft, lockProject, projectFor } from "./shared";
import { buildProjectAIContext, contextForOperation, isFreshAIContext, markEstimateForReview, type ProjectAIContext } from "./ai-context.service";
import { revalidate, type ReviewState } from "./ai-validation.service";
import { comparisonSchema, calculateAmount, ratesSchema } from "@/lib/model";
import { buildChangeApprovalImpact, changeTargetFingerprint, impactPhase, impactValuesFingerprint, readChangeApprovalSnapshot, type ChangeApprovalImpact } from "@/lib/change-approval-impact";
import { fingerprint } from "@/lib/fingerprint";

export const clientService = {
  list(context: SessionContext) { return prisma.client.findMany({ where: { workspaceId: context.workspaceId }, orderBy: { createdAt: "desc" } }); },
  create(context: SessionContext, input: Omit<Prisma.ClientCreateManyInput, "workspaceId">) { requireOwner(context); return prisma.client.create({ data: { ...input, workspaceId: context.workspaceId } }); },
  async get(context: SessionContext, id: string) {
    const client = await prisma.client.findFirst({ where: { id, workspaceId: context.workspaceId }, include: { projects: { where: { deletedAt: null }, select: { id: true, name: true, status: true } } } });
    if (!client) throw notFound("CLIENT_NOT_FOUND", "고객을 찾을 수 없습니다.");
    return client;
  },
  async update(context: SessionContext, id: string, input: Prisma.ClientUpdateManyMutationInput) {
    requireOwner(context);
    const result = await prisma.client.updateMany({ where: { id, workspaceId: context.workspaceId }, data: input });
    if (!result.count) throw notFound("CLIENT_NOT_FOUND", "고객을 찾을 수 없습니다.");
    return this.get(context, id);
  },
  async remove(context: SessionContext, id: string) {
    requireOwner(context); await this.get(context, id);
    if (await prisma.project.count({ where: { workspaceId: context.workspaceId, clientId: id } })) throw new ApiError("CLIENT_IN_USE", "프로젝트 이력이 있는 고객은 삭제할 수 없습니다.", 409);
    await prisma.client.delete({ where: { id } });
  },
};

export const projectService = {
  list(context: SessionContext) {
    return prisma.project.findMany({ where: { workspaceId: context.workspaceId, deletedAt: null }, include: {
      client: { select: { id: true, name: true, company: true } }, changeRequests: { orderBy: { number: "desc" } },
      scopes: { select: { id: true, majorVersion: true, minorVersion: true, status: true, document: true }, orderBy: [{ majorVersion: "desc" }, { minorVersion: "desc" }], take: 1 },
      estimate: { include: { items: true } }, questions: { select: { id: true, answer: { select: { id: true } } } },
    }, orderBy: { updatedAt: "desc" } });
  },
  async create(context: SessionContext, input: Omit<Prisma.ProjectUncheckedCreateInput, "workspaceId" | "clientId"> & { clientId?: string }, initialContent?: string, newClient?: { name: string; email: string; company: string; phone: string; notes: string }) {
    requireOwner(context);
    return prisma.$transaction(async tx => {
      const client = newClient ? await tx.client.create({ data: { ...newClient, workspaceId: context.workspaceId } }) : input.clientId ? await tx.client.findFirst({ where: { id: input.clientId, workspaceId: context.workspaceId } }) : null;
      if (!client) throw notFound("CLIENT_NOT_FOUND", "고객을 선택하거나 새 고객 정보를 입력해주세요.");
      const project = await tx.project.create({ data: { ...input, clientId: client.id, workspaceId: context.workspaceId } });
      if (initialContent) await tx.initialRequest.create({ data: { projectId: project.id, content: initialContent } });
      await audit(tx, context, "PROJECT_CREATED", "Project", project.id, project.id, { name: project.name });
      return project;
    });
  },
  async get(context: SessionContext, id: string) {
    await projectFor(context, id);
    const project = await prisma.project.findUniqueOrThrow({ where: { id }, include: { client: true, initialRequest: true, questions: { include: { answer: true }, orderBy: { position: "asc" } }, requirements: { orderBy: { createdAt: "asc" } }, estimate: { include: { items: true } }, scopes: { orderBy: [{ majorVersion: "desc" }, { minorVersion: "desc" }] }, changeRequests: { orderBy: { number: "desc" } }, accessTokens: { select: { id: true, purpose: true, expiresAt: true, revokedAt: true, createdAt: true, _count: { select: { feedback: true } } }, orderBy: { createdAt: "desc" } }, feedback: { orderBy: { createdAt: "desc" } }, auditLogs: { orderBy: { createdAt: "desc" }, take: 20 } } });
    const aiContext = await buildProjectAIContext(context, id, "REQUIREMENTS");
    const savedDrafts = project.aiDrafts as Record<string, Partial<ReviewState> & { context?: unknown; result?: unknown; operation?: ProjectAIContext["operation"]; inputFingerprint?: string }>;
    const aiDrafts = Object.fromEntries(Object.entries(savedDrafts).map(([task, draft]) => {
      const current = contextForOperation(aiContext, draft.operation ?? "REQUIREMENTS");
      return [task, { ...draft, validation: revalidate(current, draft.candidate ?? draft.result, draft), status: !draft.inputFingerprint || !draft.operation ? "UNVERIFIED" : isFreshAIContext(current, draft) ? "READY" : "CHANGED" }];
    }));
    const approvalTokens = await prisma.clientAccessToken.findMany({ where: { projectId: id, purpose: "CHANGE" }, orderBy: { createdAt: "desc" }, distinct: ["changeRequestId"], select: { changeRequestId: true, approvalSnapshot: true } });
    const changeRequests = await Promise.all(project.changeRequests.map(async change => {
      const baseline = project.scopes.find(s => s.id === change.baseScopeId) ?? null;
      const result = project.scopes.find(s => s.id === change.resultScopeId);
      const resultScope = result ? { id: result.id, version: `${result.majorVersion}.${result.minorVersion}` } : null;
      const phase = impactPhase(change.status);
      const frozen = ["WAITING_CLIENT_APPROVAL", "APPROVED", "REJECTED"].includes(change.status) ? approvalTokens.find(t => t.changeRequestId === change.id) : null;
      const snapshot = readChangeApprovalSnapshot(frozen?.approvalSnapshot);
      const computed = buildChangeApprovalImpact({ change: { ...change, amount: comparisonSchema.safeParse(change.review).success ? change.amount : null }, baseline, phase, resultScope, datePolicy: "CALENDAR_DAYS_UTC" });
      const impact: ChangeApprovalImpact = { ...(snapshot?.impact ?? computed), phase, resultScope, canApprove: computed.canApprove, approvalBlockReason: computed.approvalBlockReason };
      if (snapshot && (changeTargetFingerprint(change) !== snapshot.targetFingerprint || impactValuesFingerprint(computed) !== impactValuesFingerprint(snapshot.impact) || !baseline || fingerprint(baseline.document) !== snapshot.baselineFingerprint)) { impact.canApprove = false; impact.approvalBlockReason = "발급된 승인 내용이 변경되었습니다. 재검토가 필요합니다."; }
      if (["APPROVED", "REJECTED", "CANCELLED"].includes(change.status)) return { ...change, impact };
      const saved = change.analysisContext as Partial<ReviewState> & { context?: unknown; inputFingerprint?: string } | null;
      const current = await buildProjectAIContext(context, id, "SCOPE_COMPARISON", { changeId: change.id });
      const parsed = comparisonSchema.safeParse(change.review);
      const calculated = parsed.success ? calculateAmount(parsed.data.estimatedWork, ratesSchema.parse(change.rates)) : 0;
      const validation = revalidate(current, saved?.candidate ?? change.review, saved, { kind: "CHANGE", amounts: { calculated, final: change.amount, adjustmentReason: change.adjustmentReason ?? "" } });
      const status = (!change.analysis || saved && isFreshAIContext(current, saved)) && current.approvedBaseline?.isCurrent ? "READY" : "CHANGED";
      if (status !== "READY" || !["passed", "passed_with_warnings"].includes(validation.status)) { impact.canApprove = false; impact.approvalBlockReason = status !== "READY" ? "기준 Scope 또는 검토 내용이 변경되어 재검토가 필요합니다." : "금액·기간 검토가 필요합니다."; }
      return { ...change, impact, analysisContext: { ...(change.analysisContext as object), context: current, validation, status } };
    }));
    return { ...project, aiContext, aiDrafts, changeRequests, auditLogs: await activities(context.workspaceId, project.auditLogs) };
  },
  async update(context: SessionContext, id: string, input: Prisma.ProjectUpdateInput) {
    requireOwner(context);
    return editDraft(context, id, async tx => { await markEstimateForReview(tx, id); return tx.project.update({ where: { id }, data: input }); });
  },
  async remove(context: SessionContext, id: string) {
    requireOwner(context);
    return editDraft(context, id, async tx => {
      if (await tx.scope.count({ where: { projectId: id } })) throw new ApiError("PROJECT_HAS_SCOPE", "Scope가 있는 프로젝트는 삭제 대신 취소해주세요.", 409);
      await tx.clientAccessToken.updateMany({ where: { projectId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.project.update({ where: { id }, data: { deletedAt: new Date() } });
    });
  },
  async setStatus(context: SessionContext, id: string, status: "ACTIVE" | "COMPLETED" | "CANCELLED") {
    requireOwner(context);
    return prisma.$transaction(async tx => {
      await lockProject(tx, id); const project = await projectFor(context, id, tx);
      if (await tx.scope.count({ where: { projectId: id, status: "WAITING_APPROVAL" } }) || await tx.changeRequest.count({ where: { projectId: id, status: "WAITING_CLIENT_APPROVAL" } })) throw new ApiError("APPROVAL_PENDING", "승인 요청을 먼저 처리하거나 회수해주세요.", 409);
      if (status !== "CANCELLED" && !await tx.scope.count({ where: { projectId: id, status: "APPROVED" } })) throw new ApiError("SCOPE_APPROVAL_REQUIRED", "Scope 승인 후 변경할 수 있는 상태입니다.", 409);
      if (status !== "ACTIVE") await tx.clientAccessToken.updateMany({ where: { projectId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await audit(tx, context, "PROJECT_STATUS_CHANGED", "Project", id, id, { from: project.status, to: status });
      return tx.project.update({ where: { id }, data: { status } });
    });
  },
};

export const requirementService = {
  async list(context: SessionContext, projectId: string) { await projectFor(context, projectId); return prisma.requirement.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } }); },
  async create(context: SessionContext, projectId: string, input: Prisma.RequirementUncheckedCreateWithoutProjectInput) {
    return editDraft(context, projectId, async tx => {
      const requirement = await tx.requirement.create({ data: { ...input, projectId } });
      await markEstimateForReview(tx, projectId);
      await audit(tx, context, "REQUIREMENT_CREATED", "Requirement", requirement.id, projectId, { title: requirement.title });
      return requirement;
    });
  },
  async update(context: SessionContext, projectId: string, id: string, input: Prisma.RequirementUpdateInput & { decisionReason?: string }) {
    return editDraft(context, projectId, async tx => {
      const previous = await tx.requirement.findFirst({ where: { id, projectId } });
      if (!previous) throw notFound("REQUIREMENT_NOT_FOUND", "요구사항을 찾을 수 없습니다.");
      const { decisionReason, ...fields } = input;
      const customerEdit = previous.status === "CONFIRMED" && previous.source !== "OWNER_MANUAL" && (["title", "description", "status"] as const).some(key => fields[key] !== undefined && fields[key] !== previous[key]);
      if (customerEdit && !decisionReason?.trim()) throw new ApiError("AI_REVIEW_REASON_REQUIRED", "고객 조건이 반영된 요구사항을 수정하는 사유와 근거를 입력해주세요.", 422);
      await markEstimateForReview(tx, projectId);
      const provenance = customerEdit ? { ...(previous.provenance as object), editedBy: context.userId, reason: decisionReason, customerApproved: false } : previous.provenance;
      const updated = await tx.requirement.update({ where: { id }, data: { ...fields, provenance: provenance as Prisma.InputJsonValue } });
      await audit(tx, context, "REQUIREMENT_UPDATED", "Requirement", id, projectId, { reason: decisionReason ?? "", previous: { title: previous.title, description: previous.description, status: previous.status }, sourceRefs: (previous.provenance as { sourceRefs?: string[] }).sourceRefs ?? [] });
      return updated;
    });
  },
  async remove(context: SessionContext, projectId: string, id: string) {
    return editDraft(context, projectId, async tx => {
      // Draft snapshots stay readable, but must be refreshed before approval.
      await tx.scopeRequirement.deleteMany({ where: { requirementId: id, scope: { projectId, status: "DRAFT" } } });
      const result = await tx.requirement.deleteMany({ where: { id, projectId } });
      if (!result.count) throw notFound("REQUIREMENT_NOT_FOUND", "요구사항을 찾을 수 없습니다.");
      await markEstimateForReview(tx, projectId);
    });
  },
};

export const questionService = {
  async list(context: SessionContext, projectId: string) { await projectFor(context, projectId); return prisma.clarificationQuestion.findMany({ where: { projectId }, include: { answer: true }, orderBy: { position: "asc" } }); },
  async answer(context: SessionContext, projectId: string, questionId: string, content: string, author: string) {
    return editDraft(context, projectId, async tx => {
      if (!await tx.clarificationQuestion.count({ where: { id: questionId, projectId } })) throw notFound("QUESTION_NOT_FOUND", "질문을 찾을 수 없습니다.");
      await markEstimateForReview(tx, projectId);
      await audit(tx, context, "ANSWER_SAVED", "ClarificationQuestion", questionId, projectId, { author });
      return tx.clarificationAnswer.upsert({ where: { questionId }, create: { questionId, content, author }, update: { content, author } });
    });
  },
};

export const rateCardService = {
  get(context: SessionContext) { return prisma.rateCard.findUnique({ where: { workspaceId: context.workspaceId } }); },
  update(context: SessionContext, rates: Prisma.InputJsonValue) { requireOwner(context); return prisma.rateCard.upsert({ where: { workspaceId: context.workspaceId }, create: { workspaceId: context.workspaceId, rates }, update: { rates } }); },
};
