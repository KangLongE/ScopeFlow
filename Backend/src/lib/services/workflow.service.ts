import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ApiError, notFound } from "@/lib/errors";
import type { SessionContext } from "@/lib/auth/session";
import { requireEditable, requireOwner } from "@/lib/auth/permissions";
import { addDays, calculateAmount, comparisonSchema, defaultRates, nextVersion, ratesSchema } from "@/lib/model";
import { audit, projectFor, type Db } from "./shared";

const jsonValue = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

async function createToken(projectId: string, purpose: "QUESTIONS" | "SCOPE" | "CHANGE", targetId?: string, db: Db = prisma) {
  const raw = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await db.clientAccessToken.create({ data: { projectId, purpose, tokenHash: hashToken(raw), expiresAt, ...(purpose === "SCOPE" ? { scopeId: targetId } : purpose === "CHANGE" ? { changeRequestId: targetId } : {}) } });
  return { token: raw, expiresAt };
}

async function scopeDocument(projectId: string) {
  const [project, requirements, estimate] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId }, include: { client: { select: { name: true, company: true } } } }),
    prisma.requirement.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } }),
    prisma.estimate.findUnique({ where: { projectId }, include: { items: true } }),
  ]);
  if (!project || !requirements.length) throw new ApiError("REQUIREMENTS_REQUIRED", "Scope 생성 전에 요구사항이 필요합니다.", 409);
  const rates = estimate ? ratesSchema.parse(estimate.rates) : defaultRates;
  const items = (estimate?.items ?? []).map((item) => { const hours = z.object({ frontend: z.number(), backend: z.number(), design: z.number(), qa: z.number() }).parse(item.hours); return { requirementId: item.requirementId, title: requirements.find((requirement) => requirement.id === item.requirementId)?.title ?? "요구사항", hours, complexity: item.complexity, reason: item.reason, amount: calculateAmount(hours, rates) }; });
  const subtotal = items.reduce((sum, item) => sum + item.amount, 0);
  const totalHours = items.reduce((sum, item) => sum + Object.values(item.hours).reduce((a, b) => a + b, 0), 0);
  return {
    description: `${project.name} 프로젝트의 확정 범위입니다.`,
    client: project.client,
    requirements: requirements.map(({ id, category, title, description, type, priority, source }) => ({ id, category, title, description, type, priority, source })),
    estimate: { items, rates, subtotal, total: estimate?.overrideTotal ?? subtotal, adjustmentReason: estimate?.adjustmentReason ?? "" },
    excluded: [], assumptions: [], integrations: [], deliverables: requirements.map((item) => item.title),
    durationDays: Math.max(1, Math.ceil(totalHours / 8)),
    deadline: project.deadline?.toISOString().slice(0, 10) ?? null,
  };
}

export const scopeService = {
  async list(context: SessionContext, projectId: string) { await projectFor(context, projectId); return prisma.scope.findMany({ where: { projectId }, include: { requirements: { orderBy: { position: "asc" } } }, orderBy: [{ majorVersion: "desc" }, { minorVersion: "desc" }] }); },
  async get(context: SessionContext, projectId: string, scopeId: string) {
    await projectFor(context, projectId);
    const scope = await prisma.scope.findFirst({ where: { id: scopeId, projectId }, include: { requirements: { orderBy: { position: "asc" } } } });
    if (!scope) throw notFound("SCOPE_NOT_FOUND", "Scope를 찾을 수 없습니다.");
    return scope;
  },
  async create(context: SessionContext, projectId: string, input: { document?: Record<string, unknown>; requirementIds?: string[] }) {
    requireOwner(context);
    const project = await projectFor(context, projectId); requireEditable(project.status);
    if (await prisma.scope.count({ where: { projectId, status: { in: ["DRAFT", "WAITING_APPROVAL"] } } })) throw new ApiError("SCOPE_DRAFT_EXISTS", "기존 Scope 초안을 먼저 처리해주세요.", 409);
    const latest = await prisma.scope.findFirst({ where: { projectId, status: "APPROVED" }, orderBy: [{ majorVersion: "desc" }, { minorVersion: "desc" }] });
    const version = nextVersion(latest);
    const requirements = await prisma.requirement.findMany({ where: { projectId, ...(input.requirementIds ? { id: { in: input.requirementIds } } : {}) }, orderBy: { createdAt: "asc" } });
    if (!requirements.length || (input.requirementIds && requirements.length !== input.requirementIds.length)) throw new ApiError("INVALID_REQUIREMENTS", "Scope에 포함할 요구사항을 확인해주세요.", 422);
    const snapshot = await scopeDocument(projectId);
    const document = { ...snapshot, ...input.document, requirements: snapshot.requirements, estimate: snapshot.estimate, deadline: snapshot.deadline };
    return prisma.$transaction(async (tx) => {
      const scope = await tx.scope.create({ data: { projectId, ...version, basedOnRevision: project.revision, document: jsonValue(document), requirements: { create: requirements.map((requirement, position) => ({ requirementId: requirement.id, position, snapshot: jsonValue(requirement) })) } } });
      await audit(tx, context, "SCOPE_CREATED", "Scope", scope.id, projectId, version);
      return scope;
    });
  },
  async update(context: SessionContext, projectId: string, scopeId: string, input: { document?: Record<string, unknown>; requirementIds?: string[] }) {
    requireOwner(context); await projectFor(context, projectId);
    const scope = await prisma.scope.findFirst({ where: { id: scopeId, projectId } });
    if (!scope) throw notFound("SCOPE_NOT_FOUND", "Scope를 찾을 수 없습니다.");
    if (scope.status !== "DRAFT") throw new ApiError("SCOPE_IMMUTABLE", "초안 Scope만 수정할 수 있습니다.", 409);
    const snapshot = input.document ? await scopeDocument(projectId) : null;
    const document = snapshot ? { ...snapshot, ...input.document, requirements: snapshot.requirements, estimate: snapshot.estimate, deadline: snapshot.deadline } : undefined;
    return prisma.$transaction(async (tx) => {
      if (input.requirementIds) {
        const requirements = await tx.requirement.findMany({ where: { projectId, id: { in: input.requirementIds } }, orderBy: { createdAt: "asc" } });
        if (requirements.length !== input.requirementIds.length) throw new ApiError("INVALID_REQUIREMENTS", "요구사항을 확인해주세요.", 422);
        await tx.scopeRequirement.deleteMany({ where: { scopeId } });
        await tx.scopeRequirement.createMany({ data: requirements.map((requirement, position) => ({ scopeId, requirementId: requirement.id, position, snapshot: jsonValue(requirement) })) });
      }
      return tx.scope.update({ where: { id: scopeId }, data: { document: document ? jsonValue(document) : undefined } });
    });
  },
  async requestApproval(context: SessionContext, projectId: string, scopeId: string) {
    requireOwner(context); const project = await projectFor(context, projectId); requireEditable(project.status);
    const scope = await prisma.scope.findFirst({ where: { id: scopeId, projectId } });
    if (!scope) throw notFound("SCOPE_NOT_FOUND", "Scope를 찾을 수 없습니다.");
    if (scope.status !== "DRAFT") throw new ApiError("SCOPE_NOT_DRAFT", "초안 Scope만 승인 요청할 수 있습니다.", 409);
    if (scope.basedOnRevision !== project.revision) throw new ApiError("SCOPE_STALE", "요구사항이 변경되어 Scope 초안을 다시 만들어야 합니다.", 409);
    if (!await prisma.estimate.count({ where: { projectId } })) throw new ApiError("ESTIMATE_REQUIRED", "승인 요청 전에 견적이 필요합니다.", 409);
    const snapshot = await scopeDocument(projectId);
    const existing = scope.document as Record<string, unknown>;
    const document = { ...snapshot, ...existing, requirements: snapshot.requirements, estimate: snapshot.estimate, durationDays: snapshot.durationDays, deadline: snapshot.deadline };
    return prisma.$transaction(async (tx) => {
      await tx.scope.update({ where: { id: scopeId }, data: { status: "WAITING_APPROVAL", document: jsonValue(document) } });
      await tx.project.update({ where: { id: projectId }, data: { status: "WAITING_SCOPE_APPROVAL" } });
      await tx.clientAccessToken.updateMany({ where: { scopeId, revokedAt: null }, data: { revokedAt: new Date() } });
      return createToken(projectId, "SCOPE", scopeId, tx);
    });
  },
};

export const changeRequestService = {
  async list(context: SessionContext, projectId: string) { await projectFor(context, projectId); return prisma.changeRequest.findMany({ where: { projectId }, orderBy: { number: "desc" } }); },
  async create(context: SessionContext, projectId: string, request: string) {
    requireOwner(context); const project = await projectFor(context, projectId); requireEditable(project.status);
    if (!["ACTIVE", "WAITING_CHANGE_APPROVAL"].includes(project.status)) throw new ApiError("SCOPE_APPROVAL_REQUIRED", "승인된 Scope가 있는 진행 중 프로젝트에서 변경 요청을 만들 수 있습니다.", 409);
    const [base, last, card] = await Promise.all([prisma.scope.findFirst({ where: { projectId, status: "APPROVED" }, orderBy: [{ majorVersion: "desc" }, { minorVersion: "desc" }] }), prisma.changeRequest.findFirst({ where: { projectId }, orderBy: { number: "desc" } }), prisma.rateCard.findUnique({ where: { workspaceId: context.workspaceId } })]);
    if (!base) throw new ApiError("SCOPE_APPROVAL_REQUIRED", "승인된 Scope가 필요합니다.", 409);
    return prisma.$transaction(async (tx) => {
      const change = await tx.changeRequest.create({ data: { projectId, number: (last?.number ?? 0) + 1, baseScopeId: base.id, request, rates: card?.rates ?? jsonValue({ frontend: 50_000, backend: 60_000, design: 45_000, qa: 40_000 }) } });
      await audit(tx, context, "CHANGE_REQUEST_CREATED", "ChangeRequest", change.id, projectId, { number: change.number });
      return change;
    });
  },
  async internalApprove(context: SessionContext, projectId: string, id: string) {
    requireOwner(context); await projectFor(context, projectId);
    const change = await prisma.changeRequest.findFirst({ where: { id, projectId } });
    if (!change?.review) throw new ApiError("CHANGE_REVIEW_REQUIRED", "AI 분석 또는 직접 검토 결과가 필요합니다.", 409);
    const review = comparisonSchema.parse(change.review);
    if (review.classification === "UNCERTAIN") throw new ApiError("CHANGE_REVIEW_UNCERTAIN", "불명확한 분석은 담당자가 수정해야 합니다.", 409);
    return prisma.changeRequest.update({ where: { id }, data: { reviewedBy: context.userId, status: "DRAFT", revision: { increment: 1 } } });
  },
  async requestApproval(context: SessionContext, projectId: string, id: string) {
    requireOwner(context); await projectFor(context, projectId);
    const change = await prisma.changeRequest.findFirst({ where: { id, projectId } });
    if (!change?.reviewedBy || change.status !== "DRAFT") throw new ApiError("INTERNAL_APPROVAL_REQUIRED", "내부 검토 완료 후 고객 승인을 요청해주세요.", 409);
    const current = await prisma.scope.findFirst({ where: { projectId, status: "APPROVED" }, orderBy: [{ majorVersion: "desc" }, { minorVersion: "desc" }] });
    if (current?.id !== change.baseScopeId) throw new ApiError("SCOPE_VERSION_CHANGED", "기준 Scope가 변경되었습니다. 새 변경 요청이 필요합니다.", 409);
    return prisma.$transaction(async (tx) => {
      await tx.changeRequest.update({ where: { id }, data: { status: "WAITING_CLIENT_APPROVAL", revision: { increment: 1 } } });
      await tx.project.update({ where: { id: projectId }, data: { status: "WAITING_CHANGE_APPROVAL" } });
      await tx.clientAccessToken.updateMany({ where: { changeRequestId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      return createToken(projectId, "CHANGE", id, tx);
    });
  },
};

export const clientAccessService = {
  async create(context: SessionContext, projectId: string, purpose: "QUESTIONS" | "SCOPE" | "CHANGE", targetId?: string) {
    requireOwner(context); await projectFor(context, projectId);
    if (purpose !== "QUESTIONS" && !targetId) throw new ApiError("TARGET_REQUIRED", "승인 대상 ID가 필요합니다.", 422);
    if (purpose === "SCOPE" && !await prisma.scope.count({ where: { id: targetId, projectId } })) throw notFound("SCOPE_NOT_FOUND", "Scope를 찾을 수 없습니다.");
    if (purpose === "CHANGE" && !await prisma.changeRequest.count({ where: { id: targetId, projectId } })) throw notFound("CHANGE_NOT_FOUND", "변경 요청을 찾을 수 없습니다.");
    return createToken(projectId, purpose, targetId);
  },
  async token(raw: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(raw)) throw notFound("ACCESS_LINK_NOT_FOUND", "유효하지 않은 공유 링크입니다.");
    const token = await prisma.clientAccessToken.findUnique({ where: { tokenHash: hashToken(raw) } });
    if (!token || token.revokedAt || token.expiresAt <= new Date()) throw notFound("ACCESS_LINK_NOT_FOUND", "만료되었거나 회수된 공유 링크입니다.");
    return token;
  },
  async get(raw: string) {
    const token = await this.token(raw);
    const project = await prisma.project.findUnique({ where: { id: token.projectId }, include: { workspace: { select: { name: true } } } });
    if (!project || project.deletedAt) throw notFound("PROJECT_NOT_FOUND", "프로젝트를 찾을 수 없습니다.");
    const [scope, change, questions] = await Promise.all([
      token.scopeId ? prisma.scope.findFirst({ where: { id: token.scopeId, projectId: project.id }, select: { id: true, majorVersion: true, minorVersion: true, status: true, document: true, approvedAt: true, approvedBy: true } }) : null,
      token.changeRequestId ? prisma.changeRequest.findFirst({ where: { id: token.changeRequestId, projectId: project.id }, select: { id: true, number: true, request: true, review: true, amount: true, status: true, approvedAt: true, approvedBy: true, baseScope: { select: { document: true } } } }) : null,
      token.purpose === "QUESTIONS" ? prisma.clarificationQuestion.findMany({ where: { projectId: project.id }, select: { id: true, question: true, reason: true, answer: { select: { content: true, author: true } } }, orderBy: { position: "asc" } }) : [],
    ]);
    const baseDocument = change?.baseScope.document as { deadline?: unknown } | undefined;
    const review = change?.review ? comparisonSchema.parse(change.review) : null;
    const baseDeadline = typeof baseDocument?.deadline === "string" ? baseDocument.deadline : null;
    return { project: { name: project.name, status: project.status }, workspaceName: project.workspace.name, purpose: token.purpose, expiresAt: token.expiresAt, scope, change: change ? { ...change, baseScope: undefined, baseDeadline, newDeadline: addDays(baseDeadline, review?.scheduleImpactDays ?? 0) } : null, questions };
  },
  async answer(raw: string, questionId: string, content: string, author: string) {
    const token = await this.token(raw);
    if (token.purpose !== "QUESTIONS") throw new ApiError("WRONG_LINK_PURPOSE", "답변용 링크가 아닙니다.", 403);
    const question = await prisma.clarificationQuestion.findFirst({ where: { id: questionId, projectId: token.projectId } });
    if (!question) throw notFound("QUESTION_NOT_FOUND", "질문을 찾을 수 없습니다.");
    return prisma.clarificationAnswer.upsert({ where: { questionId }, create: { questionId, content, author }, update: { content, author } });
  },
  async decide(raw: string, decision: "APPROVE" | "REVISE" | "REJECT", name: string, message: string) {
    const found = await this.token(raw);
    return prisma.$transaction(async (tx) => {
      const token = await tx.clientAccessToken.findUnique({ where: { id: found.id } });
      if (!token || token.revokedAt || token.expiresAt <= new Date()) throw notFound("ACCESS_LINK_NOT_FOUND", "만료되었거나 회수된 공유 링크입니다.");
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
      await tx.clientAccessToken.update({ where: { id: token.id }, data: { revokedAt: new Date() } });
      await tx.clientFeedback.create({ data: { projectId: project.id, tokenId: token.id, decision, name, message } });
      await tx.auditLog.create({ data: { workspaceId: project.workspaceId, projectId: project.id, event: `CLIENT_${decision}`, entityType: token.purpose, entityId: token.scopeId ?? token.changeRequestId, metadata: { name, message } } });
      return { decision };
    });
  },
};
