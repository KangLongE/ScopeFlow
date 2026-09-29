import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ApiError, notFound } from "@/lib/errors";
import type { SessionContext } from "@/lib/auth/session";
import { requireEditable, requireOwner } from "@/lib/auth/permissions";
import { addDays, calculateAmount, comparisonSchema, defaultRates, nextVersion, ratesSchema, scopeSummarySchema } from "@/lib/model";
import { audit, lockProject, projectFor, requireDraft, type Db } from "./shared";

const jsonValue = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

async function createToken(projectId: string, purpose: "QUESTIONS" | "SCOPE" | "CHANGE", targetId?: string, db: Db = prisma) {
  const raw = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await db.clientAccessToken.create({ data: { projectId, purpose, tokenHash: hashToken(raw), expiresAt, ...(purpose === "SCOPE" ? { scopeId: targetId } : purpose === "CHANGE" ? { changeRequestId: targetId } : {}) } });
  return { token: raw, expiresAt };
}

async function scopeDocument(projectId: string, db: Db, approval = false) {
  const [project, all, estimate, unanswered] = await Promise.all([
    db.project.findUnique({ where: { id: projectId }, include: { client: { select: { name: true, company: true } } } }),
    db.requirement.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } }),
    db.estimate.findUnique({ where: { projectId }, include: { items: true } }),
    db.clarificationQuestion.count({ where: { projectId, answer: null } }),
  ]);
  const requirements = all.filter(r => r.status === "CONFIRMED");
  if (!project || !requirements.length) throw new ApiError("REQUIREMENTS_REQUIRED", "확정된 요구사항을 먼저 추가해주세요.", 409);
  if (approval && (all.some(r => r.status === "PENDING") || unanswered)) throw new ApiError("REQUIREMENTS_PENDING", "고객 답변과 확인 필요 요구사항을 먼저 처리해주세요.", 409);
  if (approval && (!estimate || requirements.some(r => !estimate.items.some(i => i.requirementId === r.id && i.reviewed)))) throw new ApiError("ESTIMATE_REVIEW_REQUIRED", "모든 확정 요구사항의 작업량을 검토해 저장해주세요.", 409);
  const rates = estimate ? ratesSchema.parse(estimate.rates) : defaultRates;
  const items = (estimate?.items ?? []).filter(i => requirements.some(r => r.id === i.requirementId)).map(item => {
    const hours = z.object({ frontend: z.number(), backend: z.number(), design: z.number(), qa: z.number() }).parse(item.hours);
    return { requirementId: item.requirementId, title: requirements.find(r => r.id === item.requirementId)!.title, hours, complexity: item.complexity, reason: item.reason, amount: calculateAmount(hours, rates) };
  });
  const subtotal = items.reduce((sum, item) => sum + item.amount, 0);
  const totalHours = items.reduce((sum, item) => sum + Object.values(item.hours).reduce((a, b) => a + b, 0), 0);
  return {
    description: `${project.name} 프로젝트의 확정 범위입니다.`, client: project.client,
    requirements: requirements.map(({ id, category, title, description, type, priority, source }) => ({ id, category, title, description, type, priority, source })),
    estimate: { items, rates, subtotal, total: estimate?.overrideTotal ?? subtotal, adjustmentReason: estimate?.adjustmentReason ?? "" },
    excluded: all.filter(r => r.status === "EXCLUDED").map(r => r.title), assumptions: [], integrations: [], deliverables: requirements.map(r => r.title),
    durationDays: Math.max(1, Math.ceil(totalHours / 8)), deadline: project.deadline?.toISOString().slice(0, 10) ?? null,
  };
}
const documentFields = scopeSummarySchema.extend({ durationDays: z.number().int().min(1).max(3650) });
type ScopeInput = { document?: Record<string, unknown>; requirementIds?: string[] };
function checkSelection(ids: string[] | undefined, snapshot: Awaited<ReturnType<typeof scopeDocument>>) {
  if (ids && (ids.length !== snapshot.requirements.length || snapshot.requirements.some(r => !ids.includes(r.id)))) throw new ApiError("INVALID_REQUIREMENTS", "포함할 요구사항은 요구사항 화면에서 확정 또는 제외로 관리해주세요.", 422);
}

export const scopeService = {
  async list(context: SessionContext, projectId: string) { await projectFor(context, projectId); return prisma.scope.findMany({ where: { projectId }, include: { requirements: { orderBy: { position: "asc" } } }, orderBy: [{ majorVersion: "desc" }, { minorVersion: "desc" }] }); },
  async get(context: SessionContext, projectId: string, scopeId: string) {
    await projectFor(context, projectId);
    const scope = await prisma.scope.findFirst({ where: { id: scopeId, projectId }, include: { requirements: { orderBy: { position: "asc" } } } });
    if (!scope) throw notFound("SCOPE_NOT_FOUND", "Scope를 찾을 수 없습니다.");
    return scope;
  },
  async create(context: SessionContext, projectId: string, input: ScopeInput) {
    requireOwner(context);
    return prisma.$transaction(async tx => {
      await lockProject(tx, projectId);
      const project = await projectFor(context, projectId, tx); await requireDraft(project, tx);
      if (await tx.scope.count({ where: { projectId } })) throw new ApiError("SCOPE_DRAFT_EXISTS", "기존 초안을 수정해주세요. 승인 이후에는 변경 요청을 이용하세요.", 409);
      const snapshot = await scopeDocument(projectId, tx);
      checkSelection(input.requirementIds, snapshot);
      const document = { ...snapshot, ...documentFields.parse({ ...snapshot, ...input.document }) };
      const scope = await tx.scope.create({ data: { projectId, ...nextVersion(null), basedOnRevision: project.revision, document: jsonValue(document), requirements: { create: snapshot.requirements.map((r, position) => ({ requirementId: r.id, position, snapshot: jsonValue(r) })) } } });
      await audit(tx, context, "SCOPE_CREATED", "Scope", scope.id, projectId);
      return scope;
    });
  },
  async update(context: SessionContext, projectId: string, scopeId: string, input: ScopeInput) {
    requireOwner(context);
    return prisma.$transaction(async tx => {
      await lockProject(tx, projectId);
      const project = await projectFor(context, projectId, tx); await requireDraft(project, tx);
      const scope = await tx.scope.findFirst({ where: { id: scopeId, projectId, status: "DRAFT" } });
      if (!scope) throw new ApiError("SCOPE_IMMUTABLE", "초안 Scope만 수정할 수 있습니다.", 409);
      const snapshot = await scopeDocument(projectId, tx);
      checkSelection(input.requirementIds, snapshot);
      const document = { ...snapshot, ...documentFields.parse({ ...snapshot, ...(scope.document as object), ...input.document }), requirements: snapshot.requirements, estimate: snapshot.estimate, deadline: snapshot.deadline };
      await tx.scopeRequirement.deleteMany({ where: { scopeId } });
      return tx.scope.update({ where: { id: scopeId }, data: { document: jsonValue(document), basedOnRevision: project.revision, requirements: { create: snapshot.requirements.map((r, position) => ({ requirementId: r.id, position, snapshot: jsonValue(r) })) } } });
    });
  },
  async requestApproval(context: SessionContext, projectId: string, scopeId: string) {
    requireOwner(context);
    return prisma.$transaction(async tx => {
      await lockProject(tx, projectId);
      const project = await projectFor(context, projectId, tx); requireEditable(project.status);
      const scope = await tx.scope.findFirst({ where: { id: scopeId, projectId } });
      if (!scope || !["DRAFT", "WAITING_APPROVAL"].includes(scope.status)) throw new ApiError("SCOPE_NOT_DRAFT", "초안 또는 승인 대기 Scope만 공유할 수 있습니다.", 409);
      if (scope.basedOnRevision !== project.revision) throw new ApiError("SCOPE_STALE", "요구사항 또는 견적이 변경되었습니다. Scope 초안을 다시 저장해주세요.", 409);
      const snapshot = await scopeDocument(projectId, tx, true);
      const fields = documentFields.parse(scope.document);
      const document = { ...snapshot, ...fields };
      await tx.scope.update({ where: { id: scopeId }, data: { status: "WAITING_APPROVAL", document: jsonValue(document) } });
      await tx.project.update({ where: { id: projectId }, data: { status: "WAITING_SCOPE_APPROVAL" } });
      await tx.clientAccessToken.updateMany({ where: { scopeId, revokedAt: null }, data: { revokedAt: new Date() } });
      return createToken(projectId, "SCOPE", scopeId, tx);
    });
  },
  async withdraw(context: SessionContext, projectId: string, scopeId: string) {
    requireOwner(context);
    return prisma.$transaction(async tx => {
      await lockProject(tx, projectId); requireEditable((await projectFor(context, projectId, tx)).status);
      const scope = await tx.scope.findFirst({ where: { id: scopeId, projectId, status: "WAITING_APPROVAL" } });
      if (!scope) throw new ApiError("SCOPE_NOT_WAITING", "승인 대기 중인 Scope가 아닙니다.", 409);
      await tx.scope.update({ where: { id: scopeId }, data: { status: "DRAFT" } });
      await tx.project.update({ where: { id: projectId }, data: { status: "REQUIREMENT_GATHERING" } });
      await tx.clientAccessToken.updateMany({ where: { scopeId, revokedAt: null }, data: { revokedAt: new Date() } });
    });
  },
};

export const changeRequestService = {
  async list(context: SessionContext, projectId: string) { await projectFor(context, projectId); return prisma.changeRequest.findMany({ where: { projectId }, orderBy: { number: "desc" } }); },
  async create(context: SessionContext, projectId: string, request: string) {
    requireOwner(context);
    return prisma.$transaction(async tx => {
      await lockProject(tx, projectId);
      const project = await projectFor(context, projectId, tx); requireEditable(project.status);
      const base = await tx.scope.findFirst({ where: { projectId, status: "APPROVED" }, orderBy: [{ majorVersion: "desc" }, { minorVersion: "desc" }] });
      if (!base) throw new ApiError("SCOPE_APPROVAL_REQUIRED", "Scope 승인 후 변경 요청을 만들 수 있습니다.", 409);
      const last = await tx.changeRequest.findFirst({ where: { projectId }, orderBy: { number: "desc" } });
      const card = await tx.rateCard.findUnique({ where: { workspaceId: context.workspaceId } });
      if (!card) throw new ApiError("RATES_REQUIRED", "작업 단가를 먼저 설정해주세요.", 409);
      const change = await tx.changeRequest.create({ data: { projectId, number: (last?.number ?? 0) + 1, baseScopeId: base.id, request, rates: card.rates as Prisma.InputJsonValue } });
      await audit(tx, context, "CHANGE_REQUEST_CREATED", "ChangeRequest", change.id, projectId, { number: change.number });
      return change;
    });
  },
  async review(context: SessionContext, projectId: string, id: string, input: { request?: string; review?: unknown; overrideAmount?: number | null; adjustmentReason?: string }) {
    requireOwner(context);
    return prisma.$transaction(async tx => {
      await lockProject(tx, projectId); requireEditable((await projectFor(context, projectId, tx)).status);
      const change = await tx.changeRequest.findFirst({ where: { id, projectId } });
      if (!change || !["DRAFT", "WAITING_INTERNAL_REVIEW"].includes(change.status)) throw new ApiError("CHANGE_NOT_EDITABLE", "검토할 수 없는 변경 요청입니다.", 409);
      const base = await tx.scope.findFirst({ where: { projectId, status: "APPROVED" }, orderBy: [{ majorVersion: "desc" }, { minorVersion: "desc" }] });
      if (base?.id !== change.baseScopeId) throw new ApiError("SCOPE_VERSION_CHANGED", "기준 Scope가 변경되었습니다. 최신 Scope에서 새 요청을 만들어주세요.", 409);
      const review = comparisonSchema.parse(input.review ?? change.review);
      const document = base.document as { requirements?: { id: string }[]; excluded?: string[] };
      if (review.affectedExistingRequirements.some(id => !document.requirements?.some(r => r.id === id)) || review.removedExclusions.some(item => !document.excluded?.includes(item))) throw new ApiError("INVALID_REVIEW", "현재 Scope에 없는 항목이 포함되어 있습니다.", 422);
      const amount = input.overrideAmount ?? calculateAmount(review.estimatedWork, ratesSchema.parse(change.rates));
      if (review.classification === "IN_SCOPE" && (review.newRequirements.length || review.removedExclusions.length || Object.values(review.estimatedWork).some(Boolean) || review.scheduleImpactDays || amount)) throw new ApiError("INVALID_IN_SCOPE_REVIEW", "기존 범위 요청에 추가 작업·비용·일정을 넣을 수 없습니다.", 422);
      if (!["IN_SCOPE", "UNCERTAIN"].includes(review.classification) && !review.newRequirements.length) throw new ApiError("NEW_REQUIREMENT_REQUIRED", "추가 요구사항을 입력해주세요.", 422);
      if (input.overrideAmount != null && !input.adjustmentReason?.trim()) throw new ApiError("ADJUSTMENT_REASON_REQUIRED", "금액 조정 이유가 필요합니다.", 422);
      return tx.changeRequest.update({ where: { id }, data: { request: input.request, review: jsonValue(review), amount, adjustmentReason: input.adjustmentReason, reviewedBy: review.classification === "UNCERTAIN" ? null : context.userId, status: review.classification === "UNCERTAIN" ? "WAITING_INTERNAL_REVIEW" : "DRAFT", revision: { increment: 1 } } });
    });
  },
  async internalApprove(context: SessionContext, projectId: string, id: string) { return this.review(context, projectId, id, {}); },
  async requestApproval(context: SessionContext, projectId: string, id: string) {
    requireOwner(context);
    return prisma.$transaction(async tx => {
      await lockProject(tx, projectId); requireEditable((await projectFor(context, projectId, tx)).status);
      const change = await tx.changeRequest.findFirst({ where: { id, projectId } });
      if (!change?.reviewedBy || !["DRAFT", "WAITING_CLIENT_APPROVAL"].includes(change.status)) throw new ApiError("INTERNAL_APPROVAL_REQUIRED", "내부 검토 완료 후 고객 승인을 요청해주세요.", 409);
      const current = await tx.scope.findFirst({ where: { projectId, status: "APPROVED" }, orderBy: [{ majorVersion: "desc" }, { minorVersion: "desc" }] });
      if (current?.id !== change.baseScopeId) throw new ApiError("SCOPE_VERSION_CHANGED", "기준 Scope가 변경되었습니다. 새 변경 요청이 필요합니다.", 409);
      if (await tx.changeRequest.count({ where: { projectId, id: { not: id }, status: "WAITING_CLIENT_APPROVAL" } })) throw new ApiError("APPROVAL_PENDING", "다른 변경 승인 요청을 먼저 처리해주세요.", 409);
      await tx.changeRequest.update({ where: { id }, data: { status: "WAITING_CLIENT_APPROVAL", revision: { increment: 1 } } });
      await tx.project.update({ where: { id: projectId }, data: { status: "WAITING_CHANGE_APPROVAL" } });
      await tx.clientAccessToken.updateMany({ where: { changeRequestId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      return createToken(projectId, "CHANGE", id, tx);
    });
  },
  async withdraw(context: SessionContext, projectId: string, id: string, cancel = false) {
    requireOwner(context);
    return prisma.$transaction(async tx => {
      await lockProject(tx, projectId); requireEditable((await projectFor(context, projectId, tx)).status);
      const change = await tx.changeRequest.findFirst({ where: { id, projectId } });
      if (!change || ["APPROVED", "REJECTED", "CANCELLED"].includes(change.status) || (!cancel && change.status !== "WAITING_CLIENT_APPROVAL")) throw new ApiError("CHANGE_NOT_EDITABLE", "이미 처리되었거나 회수할 수 없는 변경 요청입니다.", 409);
      await tx.clientAccessToken.updateMany({ where: { changeRequestId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.changeRequest.update({ where: { id }, data: { status: cancel ? "CANCELLED" : "DRAFT", revision: { increment: 1 } } });
      const waiting = await tx.changeRequest.count({ where: { projectId, status: "WAITING_CLIENT_APPROVAL" } });
      await tx.project.update({ where: { id: projectId }, data: { status: waiting ? "WAITING_CHANGE_APPROVAL" : "ACTIVE" } });
    });
  },
};

export const clientAccessService = {
  async create(context: SessionContext, projectId: string, purpose: "QUESTIONS" | "SCOPE" | "CHANGE", targetId?: string) {
    requireOwner(context);
    if (purpose === "SCOPE") return scopeService.requestApproval(context, projectId, targetId ?? "");
    if (purpose === "CHANGE") return changeRequestService.requestApproval(context, projectId, targetId ?? "");
    return prisma.$transaction(async tx => {
      await lockProject(tx, projectId);
      const project = await projectFor(context, projectId, tx); await requireDraft(project, tx);
      if (!await tx.clarificationQuestion.count({ where: { projectId } })) throw new ApiError("QUESTIONS_REQUIRED", "검토한 질문을 먼저 저장해주세요.", 409);
      await tx.clientAccessToken.updateMany({ where: { projectId, purpose, revokedAt: null }, data: { revokedAt: new Date() } });
      return createToken(projectId, purpose, undefined, tx);
    });
  },
  async token(raw: string, receipt = false) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(raw)) throw notFound("ACCESS_LINK_NOT_FOUND", "유효하지 않은 공유 링크입니다.");
    const token = await prisma.clientAccessToken.findUnique({ where: { tokenHash: hashToken(raw) }, include: { feedback: { select: { decision: true, name: true, createdAt: true }, take: 1 } } });
    if (!token || token.revokedAt || (!receipt && token.feedback.length > 0) || token.expiresAt <= new Date()) throw notFound("ACCESS_LINK_NOT_FOUND", "만료되었거나 처리된 공유 링크입니다.");
    return token;
  },
  async get(raw: string) {
    const token = await this.token(raw, true);
    const project = await prisma.project.findUnique({ where: { id: token.projectId }, include: { workspace: { select: { name: true } } } });
    if (!project || project.deletedAt) throw notFound("PROJECT_NOT_FOUND", "프로젝트를 찾을 수 없습니다.");
    const [scope, change, questions] = await Promise.all([
      token.scopeId ? prisma.scope.findFirst({ where: { id: token.scopeId, projectId: project.id }, select: { id: true, majorVersion: true, minorVersion: true, status: true, document: true, approvedAt: true, approvedBy: true } }) : null,
      token.changeRequestId ? prisma.changeRequest.findFirst({ where: { id: token.changeRequestId, projectId: project.id }, select: { id: true, number: true, request: true, review: true, amount: true, status: true, approvedAt: true, approvedBy: true, resultScope: { select: { majorVersion: true, minorVersion: true } }, baseScope: { select: { document: true, majorVersion: true, minorVersion: true } } } }) : null,
      token.purpose === "QUESTIONS" ? prisma.clarificationQuestion.findMany({ where: { projectId: project.id }, select: { id: true, question: true, reason: true, answer: { select: { content: true, author: true } } }, orderBy: { position: "asc" } }) : [],
    ]);
    const baseDocument = change?.baseScope.document as { deadline?: unknown } | undefined;
    const review = change?.review ? comparisonSchema.parse(change.review) : null;
    const baseDeadline = typeof baseDocument?.deadline === "string" ? baseDocument.deadline : null;
    return { receipt: token.feedback[0] ?? null, project: { name: project.name, status: project.status }, workspaceName: project.workspace.name, purpose: token.purpose, expiresAt: token.expiresAt, scope, change: change ? { ...change, baseVersion: change.baseScope.majorVersion + "." + change.baseScope.minorVersion, baseScope: undefined, baseDeadline, newDeadline: addDays(baseDeadline, review?.scheduleImpactDays ?? 0) } : null, questions };
  },
  async answer(raw: string, questionId: string, content: string, author: string) {
    const token = await this.token(raw);
    if (token.purpose !== "QUESTIONS") throw new ApiError("WRONG_LINK_PURPOSE", "답변용 링크가 아닙니다.", 403);
    return prisma.$transaction(async tx => {
      await lockProject(tx, token.projectId);
      const current = await tx.clientAccessToken.findUnique({ where: { id: token.id } });
      if (!current || current.revokedAt || current.expiresAt <= new Date()) throw notFound("ACCESS_LINK_NOT_FOUND", "만료되었거나 회수된 공유 링크입니다.");
      const project = await tx.project.findUnique({ where: { id: token.projectId } });
      if (!project || project.deletedAt) throw notFound("PROJECT_NOT_FOUND", "프로젝트를 찾을 수 없습니다.");
      await requireDraft(project, tx);
      if (!await tx.clarificationQuestion.count({ where: { id: questionId, projectId: token.projectId } })) throw notFound("QUESTION_NOT_FOUND", "질문을 찾을 수 없습니다.");
      await tx.requirement.updateMany({ where: { projectId: project.id, status: "CONFIRMED" }, data: { status: "PENDING" } });
      await tx.project.update({ where: { id: project.id }, data: { revision: { increment: 1 } } });
      return tx.clarificationAnswer.upsert({ where: { questionId }, create: { questionId, content, author }, update: { content, author } });
    });
  },
  async decide(raw: string, decision: "APPROVE" | "REVISE" | "REJECT", name: string, message: string) {
    const found = await this.token(raw);
    return prisma.$transaction(async (tx) => {
      await lockProject(tx, found.projectId);
      const token = await tx.clientAccessToken.findUnique({ where: { id: found.id }, include: { feedback: { select: { id: true } } } });
      if (!token || token.revokedAt || token.feedback.length || token.expiresAt <= new Date()) throw notFound("ACCESS_LINK_NOT_FOUND", "만료되었거나 처리된 공유 링크입니다.");
      const project = await tx.project.findUnique({ where: { id: token.projectId } });
      if (!project || project.deletedAt || ["COMPLETED", "CANCELLED"].includes(project.status)) throw new ApiError("PROJECT_LOCKED", "처리할 수 없는 프로젝트입니다.", 409);
      if (decision !== "APPROVE" && !message.trim()) throw new ApiError("MESSAGE_REQUIRED", "수정 또는 거절 이유를 입력해주세요.", 422);
      if (token.purpose === "SCOPE") {
        const scope = await tx.scope.findFirst({ where: { id: token.scopeId!, projectId: project.id } });
        if (!scope || scope.status !== "WAITING_APPROVAL") throw new ApiError("SCOPE_NOT_WAITING", "현재 승인 대기 중인 Scope가 아닙니다.", 409);
        if (decision === "REJECT") throw new ApiError("USE_REVISION_REQUEST", "Scope에는 수정 요청을 남겨주세요.", 422);
        if (decision === "APPROVE") {
          if (scope.basedOnRevision !== project.revision) throw new ApiError("SCOPE_STALE", "프로젝트가 변경되어 새 Scope가 필요합니다.", 409);
          await tx.scope.update({ where: { id: scope.id }, data: { status: "APPROVED", approvedAt: new Date(), approvedBy: name } });
          await tx.project.update({ where: { id: project.id }, data: { status: "ACTIVE" } });
          await tx.auditLog.create({ data: { workspaceId: project.workspaceId, projectId: project.id, event: "SCOPE_APPROVED", entityType: "Scope", entityId: scope.id, metadata: { approvedBy: name } } });
        } else {
          await tx.scope.update({ where: { id: scope.id }, data: { status: "DRAFT" } });
          await tx.project.update({ where: { id: project.id }, data: { status: "REQUIREMENT_GATHERING" } });
        }
      } else if (token.purpose === "CHANGE") {
        const change = await tx.changeRequest.findFirst({ where: { id: token.changeRequestId!, projectId: project.id } });
        if (!change || change.status !== "WAITING_CLIENT_APPROVAL" || !change.reviewedBy || !change.review) throw new ApiError("CHANGE_NOT_WAITING", "현재 승인 가능한 변경 요청이 아닙니다.", 409);
        if (decision === "APPROVE") {
          const base = await tx.scope.findFirst({ where: { projectId: project.id, status: "APPROVED" }, include: { requirements: { orderBy: { position: "asc" } } }, orderBy: [{ majorVersion: "desc" }, { minorVersion: "desc" }] });
          if (!base || base.id !== change.baseScopeId) throw new ApiError("SCOPE_VERSION_CHANGED", "기준 Scope가 변경되었습니다.", 409);
          const review = comparisonSchema.parse(change.review);
          const added = [];
          for (const item of review.newRequirements) {
            const requirement = await tx.requirement.create({ data: { ...item, projectId: project.id, source: "CHANGE_REQUEST" } });
            await tx.changeRequestRequirement.create({ data: { changeRequestId: change.id, requirementId: requirement.id, snapshot: jsonValue(requirement) } });
            added.push(requirement);
          }
          const version = nextVersion(base);
          const document = structuredClone(base.document) as Record<string, unknown>;
          const previousRequirements = Array.isArray(document.requirements) ? document.requirements : [];
          document.requirements = [...previousRequirements, ...added.map(({ id, category, title, description, type, priority, source }) => ({ id, category, title, description, type, priority, source }))];
          document.description = `${String(document.description ?? "")}\n\n변경 요청 #${change.number}: ${change.request}`.trim();
          const estimate = typeof document.estimate === "object" && document.estimate ? document.estimate as Record<string, unknown> : {};
          const extraSubtotal = calculateAmount(review.estimatedWork, ratesSchema.parse(change.rates));
          document.estimate = { ...estimate, items: [...(Array.isArray(estimate.items) ? estimate.items : []), { requirementId: `CR-${change.number}`, title: `변경 요청 #${change.number}`, hours: review.estimatedWork, complexity: "MEDIUM", reason: review.reason, amount: change.amount }], subtotal: Number(estimate.subtotal ?? 0) + extraSubtotal, total: Number(estimate.total ?? 0) + change.amount };
          document.excluded = (Array.isArray(document.excluded) ? document.excluded : []).filter((item) => !review.removedExclusions.includes(String(item)));
          document.durationDays = Number(document.durationDays ?? 0) + review.scheduleImpactDays;
          document.deadline = addDays(typeof document.deadline === "string" ? document.deadline : null, review.scheduleImpactDays);
          const created = await tx.scope.create({ data: { projectId: project.id, ...version, status: "APPROVED", document: jsonValue(document), basedOnRevision: project.revision + 1, approvedAt: new Date(), approvedBy: name, requirements: { create: [...base.requirements.map((item) => ({ requirementId: item.requirementId, snapshot: item.snapshot as Prisma.InputJsonValue, position: item.position })), ...added.map((item, index) => ({ requirementId: item.id, snapshot: jsonValue(item), position: base.requirements.length + index }))] } } });
          await tx.changeRequest.update({ where: { id: change.id }, data: { status: "APPROVED", resultScopeId: created.id, approvedAt: new Date(), approvedBy: name } });
          await tx.project.update({ where: { id: project.id }, data: { status: "ACTIVE", revision: { increment: 1 }, deadline: typeof document.deadline === "string" ? new Date(`${document.deadline}T00:00:00.000Z`) : undefined } });
          await tx.auditLog.create({ data: { workspaceId: project.workspaceId, projectId: project.id, event: "CHANGE_REQUEST_APPROVED", entityType: "ChangeRequest", entityId: change.id, metadata: { number: change.number, scopeId: created.id, approvedBy: name } } });
        } else {
          await tx.changeRequest.update({ where: { id: change.id }, data: { status: decision === "REJECT" ? "REJECTED" : "DRAFT", reviewedBy: decision === "REVISE" ? null : change.reviewedBy, revision: { increment: 1 } } });
          await tx.project.update({ where: { id: project.id }, data: { status: "ACTIVE" } });
        }
      } else throw new ApiError("WRONG_LINK_PURPOSE", "승인용 링크가 아닙니다.", 403);
      await tx.clientFeedback.create({ data: { projectId: project.id, tokenId: token.id, decision, name, message } });
      await tx.auditLog.create({ data: { workspaceId: project.workspaceId, projectId: project.id, event: `CLIENT_${decision}`, entityType: token.purpose, entityId: token.scopeId ?? token.changeRequestId, metadata: { name, message } } });
      return { decision };
    });
  },
};
