import { randomBytes, randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ApiError, notFound } from "@/lib/errors";
import type { SessionContext } from "@/lib/auth/session";
import { requireEditable, requireOwner } from "@/lib/auth/permissions";
import { calculateAmount, comparisonSchema, defaultRates, nextVersion, ratesSchema, scopeSummarySchema, scopeAIResultSchema, requirementInputSchema } from "@/lib/model";
import { audit, lockProject, projectFor, requireDraft, type Db } from "./shared";
import { buildProjectAIContext, changedContext, excludedId, markEstimateForReview, recordAIReview, requireFreshAIContext, validateContextResult, type ProjectAIContext } from "./ai-context.service";
import { fingerprint } from "@/lib/fingerprint";
import { initialReview, revalidate, requireValidated, saveReviewState, assertCandidateRevision, auditValidation, type ReviewState } from "./ai-validation.service";
import { validateAIResult, type ValidationPolicy } from "@/lib/ai/rule-validator";
import { withChangeConditionProposals } from "@/lib/change-condition-proposals";
import type { Draft } from "./ai-workflow.service";
import { approvalTargetSchema, buildChangeApprovalImpact, changeTargetFingerprint, impactPhase, impactValuesFingerprint, publicChangeReview, readChangeApprovalSnapshot, type ApprovalTarget, type ChangeApprovalSnapshot } from "@/lib/change-approval-impact";

import { addExclusionSuggestions, carryExclusions, editExclusions, publicExclusions, readExclusionReview, requireExclusionsReviewed, type ExclusionReview } from "@/lib/scope-exclusions";

function withExclusions<T extends object>(document: T, review: ExclusionReview) { const exclusions = publicExclusions(review); return { ...document, exclusions, excluded: exclusions.map(i => i.title) }; }

const jsonValue = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

async function createToken(projectId: string, purpose: "QUESTIONS" | "SCOPE" | "CHANGE", targetId?: string, db: Db = prisma, approvalSnapshot?: ChangeApprovalSnapshot) {
  const raw = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await db.clientAccessToken.create({ data: { projectId, purpose, tokenHash: hashToken(raw), expiresAt, ...(approvalSnapshot ? { approvalSnapshot: jsonValue(approvalSnapshot) } : {}), ...(purpose === "SCOPE" ? { scopeId: targetId } : purpose === "CHANGE" ? { changeRequestId: targetId } : {}) } });
  return { token: raw, expiresAt };
}

async function scopeDocument(projectId: string, db: Db, approval = false) {
  const [project, all, estimate] = await Promise.all([
    db.project.findUnique({ where: { id: projectId }, include: { client: { select: { name: true, company: true } } } }),
    db.requirement.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } }),
    db.estimate.findUnique({ where: { projectId }, include: { items: true } }),
  ]);
  const requirements = all.filter(r => r.status === "CONFIRMED");
  if (!project || !requirements.length) throw new ApiError("REQUIREMENTS_REQUIRED", "확정된 요구사항을 먼저 추가해주세요.", 409);
  if (approval && all.some(r => r.status === "PENDING")) throw new ApiError("REQUIREMENTS_PENDING", "확인 필요 요구사항을 먼저 처리해주세요.", 409);
  if (!estimate || requirements.some(r => !estimate.items.some(i => i.requirementId === r.id && i.reviewed))) throw new ApiError("ESTIMATE_REVIEW_REQUIRED", "모든 확정 요구사항의 작업량을 검토해 저장해주세요.", 409);
  if (estimate.validationReview) requireValidated((estimate.validationReview as unknown as ReviewState).validation);
  const context = await buildProjectAIContext({ workspaceId: project.workspaceId, userId: "scope-snapshot", role: "OWNER" }, projectId, "SCOPE_SUMMARY", { db });
  if (approval && context.unresolvedItems.some(i => i.important)) throw new ApiError("AI_REVIEW_REQUIRED", "범위·비용에 중요한 조건을 먼저 확인해주세요.", 409);
  const rates = estimate ? ratesSchema.parse(estimate.rates) : defaultRates;
  const items = (estimate?.items ?? []).filter(i => requirements.some(r => r.id === i.requirementId)).map(item => {
    const hours = z.object({ frontend: z.number(), backend: z.number(), design: z.number(), qa: z.number() }).parse(item.hours);
    return { requirementId: item.requirementId, title: requirements.find(r => r.id === item.requirementId)!.title, hours, complexity: item.complexity, reason: item.reason, amount: calculateAmount(hours, rates) };
  });
  const subtotal = items.reduce((sum, item) => sum + item.amount, 0);
  return {
    description: `${project.name} 프로젝트의 확정 범위입니다.`, client: project.client,
    requirements: requirements.map(({ id, category, title, description, type, priority, source, provenance }) => ({ id, category, title, description, type, priority, source, implementation: estimate.items.find(i => i.requirementId === id)?.implementation ?? (provenance as { implementation?: unknown }).implementation ?? null })),
    estimate: { items, rates, subtotal, total: estimate?.overrideTotal ?? subtotal, adjustmentReason: estimate?.adjustmentReason ?? "" },
    exclusions: publicExclusions(context.scopeExclusions), excluded: publicExclusions(context.scopeExclusions).map(e => e.title), assumptions: [...new Set(context.ownerDecisions.map(d => `담당자 확인: ${d.description} · ${d.reason}`))], integrations: [], deliverables: requirements.map(r => r.title),
    durationDays: context.confirmedEstimate?.durationDays ?? null, deadline: project.deadline?.toISOString().slice(0, 10) ?? null,
  };
}
const documentFields = scopeSummarySchema.extend({ durationDays: z.number().int().min(1).max(3650) });
type ScopeInput = { exclusions?: unknown; document?: Record<string, unknown>; requirementIds?: string[]; reason?: string; warnings?: unknown; candidateRevision?: number };
type ScopeReview = ReviewState & { exclusionReview?: ExclusionReview; expectedScope: NonNullable<ValidationPolicy["expectedScope"]>; issuedFingerprint?: string; approvedConditionChanges?: unknown[] };
type ChangeReview = Partial<ReviewState> & { inputFingerprint?: string; operation?: ProjectAIContext["operation"]; changeId?: string; runId?: string; amounts?: ValidationPolicy["amounts"]; issuedFingerprint?: string };
function changePolicy(context: ProjectAIContext, candidate: unknown, state?: ChangeReview | null): ValidationPolicy {
  const parsed = comparisonSchema.safeParse(candidate);
  const calculated = parsed.success ? calculateAmount(parsed.data.estimatedWork, ratesSchema.parse(context.changeRequest?.rates)) : 0;
  return { kind: "CHANGE", amounts: state?.amounts ?? { calculated, final: calculated, adjustmentReason: "" }, ...(state?.issuedFingerprint ? { expectedDocumentFingerprint: state.issuedFingerprint } : {}) };
}
async function validateChangeForApproval(db: Db, session: SessionContext, projectId: string, change: { id: string; review: Prisma.JsonValue; analysisContext: Prisma.JsonValue | null; amount: number; adjustmentReason: string | null }, recordAudit = true) {
  const context = await buildProjectAIContext(session, projectId, "SCOPE_COMPARISON", { db, changeId: change.id });
  const state = change.analysisContext as ChangeReview | null;
  const policy = changePolicy(context, change.review, state);
  policy.amounts = { calculated: comparisonSchema.safeParse(change.review).success ? calculateAmount(comparisonSchema.parse(change.review).estimatedWork, ratesSchema.parse(context.changeRequest?.rates)) : 0, final: change.amount, adjustmentReason: change.adjustmentReason ?? "" };
  const validation = revalidate(context, change.review, state, policy); requireValidated(validation);
  if (state?.issuedFingerprint && fingerprint({ review: change.review, amounts: policy.amounts }) !== state.issuedFingerprint) throw new ApiError("APPROVAL_SNAPSHOT_CHANGED", "발급된 검토 내용이 변경되었습니다. 링크를 회수해주세요.", 409);
  if (recordAudit) await auditValidation(db, session, context, change.review, validation, state, "ChangeRequest", change.id);
  return { context, state, policy, validation };
}
function scopePolicy(context: ProjectAIContext, document: Record<string, unknown>, previous?: Partial<ScopeReview> | null, ownerDuration?: number): ValidationPolicy {
  return { kind: "SCOPE", exclusionReview: previous?.exclusionReview ?? context.scopeExclusions, expectedScope: { total: context.confirmedEstimate!.total, items: context.confirmedEstimate!.items, requirements: previous?.expectedScope?.requirements ?? document.requirements as unknown[], rates: context.confirmedEstimate!.rates, durationDays: ownerDuration ?? previous?.expectedScope?.durationDays ?? context.confirmedEstimate!.durationDays ?? Number(document.durationDays), deadline: context.project.deadline }, ...(previous?.issuedFingerprint ? { expectedDocumentFingerprint: previous.issuedFingerprint } : {}) };
}
async function validateScopeForApproval(db: Db, session: SessionContext, projectId: string, scope: { id: string; document: Prisma.JsonValue; validationReview: Prisma.JsonValue | null }) {
  const context = await buildProjectAIContext(session, projectId, "SCOPE_SUMMARY", { db });
  const state = scope.validationReview as Partial<ScopeReview> | null;
  requireExclusionsReviewed(context.scopeExclusions, scope.document as Record<string, unknown>);
  const candidate = state?.candidate ?? scope.document;
  const policy = scopePolicy(context, scope.document as Record<string, unknown>, state);
  const validation = revalidate(context, candidate, state, policy); requireValidated(validation);
  if (fingerprint(candidate) !== fingerprint(scope.document)) throw new ApiError("AI_RESULT_VALIDATION_FAILED", "검토 후보와 승인 문서가 다릅니다. 초안을 다시 저장해주세요.", 422, { validation });
  await auditValidation(db, session, context, candidate, validation, state, "Scope", scope.id);
  return { context, validation, state, policy };
}
function checkSelection(ids: string[] | undefined, snapshot: Awaited<ReturnType<typeof scopeDocument>>) {
  if (ids && (ids.length !== snapshot.requirements.length || snapshot.requirements.some(r => !ids.includes(r.id)))) throw new ApiError("INVALID_REQUIREMENTS", "포함할 요구사항은 요구사항 화면에서 확정 또는 제외로 관리해주세요.", 422);
}

export const scopeService = {
  async saveReview(context: SessionContext, projectId: string, scopeId: string, candidateRevision: number, candidate: unknown, warnings: unknown = []) {
    requireOwner(context);
    return prisma.$transaction(async tx => {
      await lockProject(tx, projectId); const project = await projectFor(context, projectId, tx); await requireDraft(project, tx);
      const scope = await tx.scope.findFirst({ where: { id: scopeId, projectId, status: "DRAFT" } });
      if (!scope) throw new ApiError("SCOPE_IMMUTABLE", "초안만 검토할 수 있습니다.", 409);
      const previous = scope.validationReview as Partial<ScopeReview> | null; assertCandidateRevision(previous, candidateRevision);
      const input = await buildProjectAIContext(context, projectId, "SCOPE_SUMMARY", { db: tx });
      const policy = scopePolicy(input, scope.document as Record<string, unknown>, previous && { ...previous, issuedFingerprint: undefined });
      const state = await saveReviewState(tx, context, input, candidate, scope.document, previous, warnings, policy, { type: "Scope", id: scopeId });
      // Invalid candidates remain editable, but never replace the publishable document.
      const valid = ["passed", "passed_with_warnings"].includes(state.validation.status);
      await tx.scope.update({ where: { id: scopeId }, data: { validationReview: jsonValue({ ...state, expectedScope: policy.expectedScope, exclusionReview: previous?.exclusionReview ?? input.scopeExclusions }), ...(valid ? { document: jsonValue(candidate), basedOnRevision: project.revision } : {}) } });
      return state;
    });
  },
  async applyAI(context: SessionContext, projectId: string, revision: number, value: unknown, options: { resolutions?: unknown; reason?: string; runId?: string; candidateRevision?: number; durationDays?: number }) {
    requireOwner(context);
    return prisma.$transaction(async tx => {
      await lockProject(tx, projectId);
      const project = await projectFor(context, projectId, tx); await requireDraft(project, tx);
      const drafts = project.aiDrafts as unknown as Record<string, Draft>;
      const draft = drafts.summary;
      if (!draft || draft.revision !== revision || (options.runId && draft.runId !== options.runId)) throw changedContext();
      assertCandidateRevision(draft, options.candidateRevision);
      const input = await requireFreshAIContext(context, draft, projectId, tx);
      const first = revalidate(input, value, draft);
      if (first.issues.some(i => i.severity === "ERROR" && ["RV-001", "RV-002"].includes(i.ruleId))) requireValidated(first);
      const result = scopeAIResultSchema.parse(value); validateContextResult(result, input);
      await recordAIReview(tx, context, input, result, draft.result, options.resolutions, options.reason, draft.runId);
      const latest = await buildProjectAIContext(context, projectId, "SCOPE_SUMMARY", { db: tx });
      const old = await tx.scope.findFirst({ where: { projectId, status: "DRAFT" } });
      const durationDays = options.durationDays ?? (old?.document as { durationDays?: number } | undefined)?.durationDays;
      if (!durationDays) throw new ApiError("SCOPE_DURATION_REQUIRED", "시간을 일수로 자동 환산하지 않습니다. 담당자가 예상 기간을 입력해주세요.", 422);
      if (old && durationDays !== (old.document as { durationDays: number }).durationDays && !options.reason?.trim()) throw new ApiError("AI_REVIEW_REASON_REQUIRED", "기존 확정 기간을 변경하는 사유를 입력해주세요.", 422);
      const policyForAI: ValidationPolicy = { expectedScope: { total: latest.confirmedEstimate!.total, durationDays, items: latest.confirmedEstimate!.items } };
      const validation = revalidate(latest, result, draft, policyForAI); requireValidated(validation);
      const savedReview = await saveReviewState(tx, context, latest, result, draft.result, draft, [], {}, { type: "Project", id: projectId, runId: draft.runId });
      const snapshot = await scopeDocument(projectId, tx);
      const fields = scopeSummarySchema.parse(result);
      const exclusionReview = addExclusionSuggestions(latest.scopeExclusions, fields.excluded, "ai_assumption", draft.runId);
      const document = withExclusions({ ...snapshot, ...fields, durationDays, estimate: snapshot.estimate, requirements: snapshot.requirements, deadline: snapshot.deadline }, exclusionReview);
      const policy = scopePolicy(latest, document, { exclusionReview }, document.durationDays);
      const documentValidation = validateAIResult(latest, document, policy);
      if (!exclusionReview.items.some(i => i.state === "pending")) requireValidated(documentValidation);
      const validationReview = jsonValue({ ...initialReview(latest, document, documentValidation), expectedScope: policy.expectedScope, sourceRunId: draft.runId, sourceCandidateRevision: savedReview.candidateRevision, exclusionReview });
      const links = snapshot.requirements.map((r, position) => ({ requirementId: r.id, position, snapshot: jsonValue(r) }));
      if (old) await tx.scopeRequirement.deleteMany({ where: { scopeId: old.id } });
      const scope = old ? await tx.scope.update({ where: { id: old.id }, data: { document: jsonValue(document), validationReview, basedOnRevision: project.revision, requirements: { create: links } } }) : await tx.scope.create({ data: { projectId, ...nextVersion(null), basedOnRevision: project.revision, document: jsonValue(document), validationReview, requirements: { create: links } } });
      const remaining = { ...drafts }; delete remaining.summary;
      await tx.project.update({ where: { id: projectId }, data: { aiDrafts: jsonValue(remaining) } });
      await audit(tx, context, "SCOPE_AI_REVIEWED", "Scope", scope.id, projectId, { runId: draft.runId ?? "", savedNumbersPreserved: true });
      return scope;
    }, { timeout: 15000 });
  },
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
      const fields = documentFields.parse({ ...snapshot, ...input.document });
      const latest = await buildProjectAIContext(context, projectId, "SCOPE_SUMMARY", { db: tx });
      const prepared = input.exclusions === undefined ? addExclusionSuggestions(latest.scopeExclusions, fields.excluded, "staff") : latest.scopeExclusions;
      const exclusionReview = input.exclusions === undefined ? prepared : editExclusions(prepared, input.exclusions, latest.sources, context.userId);
      const document = withExclusions({ ...snapshot, ...fields }, exclusionReview);
      const candidate = { ...document, ...(input.exclusions === undefined && input.document?.excluded !== undefined ? { excluded: input.document.excluded } : {}), ...(input.document?.estimate !== undefined ? { estimate: input.document.estimate } : {}) };
      const policy = scopePolicy(latest, document, { exclusionReview }, fields.durationDays);
      const state = await saveReviewState(tx, context, latest, candidate, document, initialReview(latest, document), input.warnings, policy, { type: "Project", id: projectId });
      const scope = await tx.scope.create({ data: { projectId, ...nextVersion(null), basedOnRevision: project.revision, document: jsonValue(document), validationReview: jsonValue({ ...state, expectedScope: policy.expectedScope, exclusionReview }), requirements: { create: snapshot.requirements.map((r, position) => ({ requirementId: r.id, position, snapshot: jsonValue(r) })) } } });
      await audit(tx, context, "SCOPE_EXCLUSIONS_REVIEWED", "Scope", scope.id, projectId, jsonValue({ exclusionRevision: exclusionReview.revision, contextFingerprint: exclusionReview.contextFingerprint, before: latest.scopeExclusions.items, after: exclusionReview.items }));
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
      const editingContext = input.exclusions === undefined ? null : await buildProjectAIContext(context, projectId, "SCOPE_SUMMARY", { db: tx });
      const editedExclusions = editingContext ? editExclusions(editingContext.scopeExclusions, input.exclusions, editingContext.sources, context.userId) : null;
      const previous = scope.document as { excluded?: string[] };
      const proposed = input.document?.excluded;
      const snapshot = await scopeDocument(projectId, tx);
      checkSelection(input.requirementIds, snapshot);
      const fields = documentFields.parse({ ...snapshot, ...(scope.document as object), ...input.document });
      const previousReview = scope.validationReview as Partial<ScopeReview> | null;
      if (input.candidateRevision !== undefined) assertCandidateRevision(previousReview, input.candidateRevision);
      if (fields.durationDays !== (scope.document as { durationDays?: number }).durationDays && !input.reason?.trim()) throw new ApiError("AI_REVIEW_REASON_REQUIRED", "확정 기간을 변경하는 사유를 남겨주세요.", 422);
      const changed = input.exclusions === undefined && Array.isArray(proposed) && JSON.stringify(previous.excluded) !== JSON.stringify(proposed);
      if (changed) {
        if (!input.reason?.trim()) throw new ApiError("AI_REVIEW_REASON_REQUIRED", "제외 조건을 변경하는 사유와 합의 근거를 입력해주세요.", 422);
        // A document edit alone cannot retire a confirmed customer condition.
        await tx.project.update({ where: { id: projectId }, data: { revision: { increment: 1 } } });
        await markEstimateForReview(tx, projectId);
        await audit(tx, context, "SCOPE_CONDITIONS_CHANGED", "Scope", scopeId, projectId, { reason: input.reason, previous: previous.excluded ?? [], excluded: fields.excluded, customerApproved: false });
      }
      const latest = await buildProjectAIContext(context, projectId, "SCOPE_SUMMARY", { db: tx });
      const prepared = input.exclusions === undefined ? addExclusionSuggestions(latest.scopeExclusions, fields.excluded, "staff") : latest.scopeExclusions;
      const exclusionReview = editedExclusions ?? prepared;
      const document = withExclusions({ ...snapshot, ...fields, requirements: snapshot.requirements, estimate: snapshot.estimate, deadline: snapshot.deadline }, exclusionReview);
      const candidate = { ...document, ...(input.document?.estimate !== undefined ? { estimate: input.document.estimate } : {}) };
      const policy = scopePolicy(latest, document, { exclusionReview }, fields.durationDays);
      const state = await saveReviewState(tx, context, latest, candidate, scope.document, previousReview, input.warnings, policy, { type: "Scope", id: scopeId });
      const legacyPending = !Array.isArray((scope.document as Record<string, unknown>).exclusions) && exclusionReview.items.some(i => i.state === "pending");
      const savedDocument = legacyPending ? { ...document, excluded: previous.excluded ?? [], exclusions: undefined } : document;
      await audit(tx, context, "SCOPE_EXCLUSIONS_REVIEWED", "Scope", scopeId, projectId, jsonValue({ exclusionRevision: exclusionReview.revision, contextFingerprint: exclusionReview.contextFingerprint, before: latest.scopeExclusions.items, after: exclusionReview.items }));
      await tx.scopeRequirement.deleteMany({ where: { scopeId } });
      return tx.scope.update({ where: { id: scopeId }, data: { document: jsonValue(savedDocument), validationReview: jsonValue({ ...state, expectedScope: policy.expectedScope, exclusionReview }), basedOnRevision: project.revision + Number(changed), requirements: { create: snapshot.requirements.map((r, position) => ({ requirementId: r.id, position, snapshot: jsonValue(r) })) } } });
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
      const checked = await validateScopeForApproval(tx, context, projectId, { ...scope, document: document as unknown as Prisma.JsonValue });
      await tx.scope.update({ where: { id: scopeId }, data: { status: "WAITING_APPROVAL", document: jsonValue(document), validationReview: jsonValue({ ...checked.state, validation: checked.validation, candidate: document, expectedScope: checked.policy.expectedScope, issuedFingerprint: fingerprint(document) }) } });
      await tx.project.update({ where: { id: projectId }, data: { status: "WAITING_SCOPE_APPROVAL" } });
      await tx.clientAccessToken.updateMany({ where: { scopeId, revokedAt: null }, data: { revokedAt: new Date() } });
      await audit(tx, context, "SCOPE_APPROVAL_REQUESTED", "Scope", scopeId, projectId);
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
  async saveRequest(context: SessionContext, projectId: string, id: string, request: string) {
    requireOwner(context);
    return prisma.$transaction(async tx => {
      await lockProject(tx, projectId); requireEditable((await projectFor(context, projectId, tx)).status);
      const previous = await tx.changeRequest.findFirst({ where: { id, projectId, status: { in: ["DRAFT", "WAITING_INTERNAL_REVIEW"] } } });
      if (!previous) throw new ApiError("CHANGE_NOT_EDITABLE", "원문을 수정할 수 없는 변경 요청입니다.", 409);
      await audit(tx, context, "CHANGE_REQUEST_EDITED", "ChangeRequest", id, projectId, { previous: previous.request, request });
      return tx.changeRequest.update({ where: { id }, data: { request, reviewedBy: null, status: "WAITING_INTERNAL_REVIEW", revision: { increment: 1 } } });
    });
  },
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
  async review(context: SessionContext, projectId: string, id: string, input: { request?: string; review?: unknown; overrideAmount?: number | null; adjustmentReason?: string; resolutions?: unknown; decisionReason?: string; candidateRevision?: number; warnings?: unknown; draftOnly?: boolean }) {
    requireOwner(context);
    return prisma.$transaction(async tx => {
      await lockProject(tx, projectId); requireEditable((await projectFor(context, projectId, tx)).status);
      const change = await tx.changeRequest.findFirst({ where: { id, projectId } });
      if (!change || !["DRAFT", "WAITING_INTERNAL_REVIEW"].includes(change.status)) throw new ApiError("CHANGE_NOT_EDITABLE", "검토할 수 없는 변경 요청입니다.", 409);
      const base = await tx.scope.findFirst({ where: { projectId, status: "APPROVED" }, orderBy: [{ majorVersion: "desc" }, { minorVersion: "desc" }] });
      if (base?.id !== change.baseScopeId) throw new ApiError("SCOPE_VERSION_CHANGED", "기준 Scope가 변경되었습니다. 최신 Scope에서 새 요청을 만들어주세요.", 409);
      const metadata = change.analysisContext as ChangeReview | null;
      assertCandidateRevision(metadata, input.candidateRevision);
      let candidate: unknown = input.review ?? change.review;
      let current = await buildProjectAIContext(context, projectId, "SCOPE_COMPARISON", { db: tx, changeId: id });
      if (change.analysis) {
        if (!metadata) throw new ApiError("AI_CONTEXT_UNVERIFIED", "이전 실행의 입력 기준 확인 불가: 새 정책으로 재비교해주세요.", 409);
        if (input.request && input.request !== change.request) throw changedContext();
        current = await requireFreshAIContext(context, metadata, projectId, tx);
      }
      candidate = withChangeConditionProposals(current, candidate);
      const parsed = comparisonSchema.safeParse(candidate);
      const calculated = parsed.success ? calculateAmount(parsed.data.estimatedWork, ratesSchema.parse(change.rates)) : 0;
      const amount = input.overrideAmount === undefined ? metadata?.amounts?.final ?? calculated : input.overrideAmount ?? calculated;
      const policy: ValidationPolicy = { kind: "CHANGE", amounts: { calculated, final: amount, adjustmentReason: input.adjustmentReason ?? metadata?.amounts?.adjustmentReason ?? "" } };
      if (!input.draftOnly) {
        const before = revalidate(current, candidate, metadata, policy);
        if (before.issues.some(i => i.severity === "ERROR" && ["RV-001", "RV-002"].includes(i.ruleId))) requireValidated(before);
        if (change.analysis) await recordAIReview(tx, context, current, candidate, change.analysis, input.resolutions, input.decisionReason, metadata?.runId);
        current = await buildProjectAIContext(context, projectId, "SCOPE_COMPARISON", { db: tx, changeId: id });
      }
      const state = await saveReviewState(tx, context, current, candidate, change.analysis ?? change.review ?? candidate, metadata, input.warnings, policy, { type: "ChangeRequest", id, runId: metadata?.runId });
      if (!input.draftOnly) requireValidated(state.validation);
      const updatedMetadata = { ...metadata, ...state, amounts: policy.amounts, inputFingerprint: current.inputFingerprint, operation: "SCOPE_COMPARISON", changeId: id, issuedFingerprint: undefined };
      await tx.changeRequest.update({ where: { id }, data: { review: jsonValue(candidate), analysisContext: jsonValue(updatedMetadata), ...(parsed.success ? { amount } : {}), adjustmentReason: policy.amounts!.adjustmentReason, reviewedBy: input.draftOnly ? null : context.userId, status: input.draftOnly ? "WAITING_INTERNAL_REVIEW" : "DRAFT", revision: { increment: 1 } } });
      const impact = buildChangeApprovalImpact({ change: { ...change, review: candidate, amount: parsed.success ? amount : null, revision: change.revision + 1 }, baseline: base, phase: "reviewing", datePolicy: "CALENDAR_DAYS_UTC", blockReason: ["passed", "passed_with_warnings"].includes(state.validation.status) ? null : "금액·기간 검토가 필요합니다." });
      return { ...state, amounts: policy.amounts, impact };
    });
  },
  async internalApprove(context: SessionContext, projectId: string, id: string, candidateRevision: number) { return this.review(context, projectId, id, { candidateRevision }); },
  async requestApproval(context: SessionContext, projectId: string, id: string) {
    requireOwner(context);
    return prisma.$transaction(async tx => {
      await lockProject(tx, projectId); requireEditable((await projectFor(context, projectId, tx)).status);
      const change = await tx.changeRequest.findFirst({ where: { id, projectId } });
      if (!change?.reviewedBy || !["DRAFT", "WAITING_CLIENT_APPROVAL"].includes(change.status)) throw new ApiError("INTERNAL_APPROVAL_REQUIRED", "내부 검토 완료 후 고객 승인을 요청해주세요.", 409);
      const current = await tx.scope.findFirst({ where: { projectId, status: "APPROVED" }, orderBy: [{ majorVersion: "desc" }, { minorVersion: "desc" }] });
      if (current?.id !== change.baseScopeId) throw new ApiError("SCOPE_VERSION_CHANGED", "기준 Scope가 변경되었습니다. 새 변경 요청이 필요합니다.", 409);
      if (change.analysis) await requireFreshAIContext(context, change.analysisContext as { inputFingerprint?: string; operation?: ProjectAIContext["operation"]; changeId?: string } ?? {}, projectId, tx);
      const checked = await validateChangeForApproval(tx, context, projectId, change);
      const issuedChange = { ...change, revision: change.revision + 1 };
      const impact = buildChangeApprovalImpact({ change: issuedChange, baseline: current, phase: "waiting", snapshotId: randomUUID(), datePolicy: "CALENDAR_DAYS_UTC" });
      if (!impact.canApprove) throw new ApiError("CHANGE_IMPACT_REVIEW_REQUIRED", impact.approvalBlockReason!, 422);
      const approvalSnapshot: ChangeApprovalSnapshot = { schemaVersion: 1, number: change.number, request: change.request, review: publicChangeReview(change.review), impact, targetFingerprint: changeTargetFingerprint(issuedChange), baselineFingerprint: fingerprint(current!.document) };
      if (await tx.changeRequest.count({ where: { projectId, id: { not: id }, status: "WAITING_CLIENT_APPROVAL" } })) throw new ApiError("APPROVAL_PENDING", "다른 변경 승인 요청을 먼저 처리해주세요.", 409);
      await tx.changeRequest.update({ where: { id }, data: { status: "WAITING_CLIENT_APPROVAL", analysisContext: jsonValue({ ...checked.state, validation: checked.validation, issuedFingerprint: fingerprint({ review: change.review, amounts: checked.policy.amounts }) }), revision: { increment: 1 } } });
      await tx.project.update({ where: { id: projectId }, data: { status: "WAITING_CHANGE_APPROVAL" } });
      await tx.clientAccessToken.updateMany({ where: { changeRequestId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await audit(tx, context, "CHANGE_APPROVAL_REQUESTED", "ChangeRequest", id, projectId, { number: change.number });
      return createToken(projectId, "CHANGE", id, tx, approvalSnapshot);
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
      token.changeRequestId ? prisma.changeRequest.findFirst({ where: { id: token.changeRequestId, projectId: project.id }, include: { resultScope: { select: { id: true, majorVersion: true, minorVersion: true, document: true } }, baseScope: true } }) : null,
      token.purpose === "QUESTIONS" ? prisma.clarificationQuestion.findMany({ where: { projectId: project.id }, select: { id: true, question: true, reason: true, answer: { select: { content: true, author: true } } }, orderBy: { position: "asc" } }) : [],
    ]);
    if (token.purpose === "CHANGE" && !change) throw notFound("ACCESS_LINK_NOT_FOUND", "승인 대상을 찾을 수 없습니다.");
    let publicChange = null;
    if (change) {
      const receipt = token.feedback[0];
      const phase = impactPhase(change.status, receipt?.decision);
      const snapshot = readChangeApprovalSnapshot(token.approvalSnapshot);
      const resultScope = phase === "approved" && change.resultScope ? { id: change.resultScope.id, version: `${change.resultScope.majorVersion}.${change.resultScope.minorVersion}` } : null;
      const resultDoc = phase === "approved" ? change.resultScope?.document as { estimate?: { total?: unknown }; durationDays?: unknown; deadline?: unknown } | undefined : undefined;
      const calculated = buildChangeApprovalImpact({ change, baseline: change.baseScope, phase, snapshotId: snapshot?.impact.approvalSnapshotId ?? `legacy:${token.id}`, datePolicy: "CALENDAR_DAYS_UTC", resultScope, ...(resultDoc ? { expectedAfter: { amount: resultDoc.estimate?.total, durationDays: resultDoc.durationDays, deadline: resultDoc.deadline } } : {}) });
      let reason = calculated.approvalBlockReason;
      if (token.approvalSnapshot != null && !snapshot) reason = "당시 승인 스냅샷 확인 불가: 담당자 재검토가 필요합니다.";
      if (snapshot && (impactValuesFingerprint(snapshot.impact) !== impactValuesFingerprint(calculated) || snapshot.baselineFingerprint !== fingerprint(change.baseScope.document) || snapshot.targetFingerprint !== changeTargetFingerprint(change))) reason = receipt && receipt.decision !== "APPROVE" ? reason : "발급된 승인 내용이 변경되었습니다. 담당자 재검토 후 새 링크를 요청해주세요.";
      if (!receipt && phase === "waiting") {
        const current = await prisma.scope.findFirst({ where: { projectId: project.id, status: "APPROVED" }, orderBy: [{ majorVersion: "desc" }, { minorVersion: "desc" }], select: { id: true } });
        if (current?.id !== change.baseScopeId) reason = "기준 Scope가 변경되어 재검토가 필요합니다.";
        else if (["COMPLETED", "CANCELLED"].includes(project.status)) reason = "처리할 수 없는 프로젝트입니다.";
        else if (!change.reviewedBy) reason = "담당자 검토가 완료되지 않았습니다.";
        else {
          try {
            const session = { workspaceId: project.workspaceId, userId: "customer-approval", role: "OWNER" as const };
            if (change.analysis) await requireFreshAIContext(session, change.analysisContext as ChangeReview ?? {}, project.id, prisma);
            await validateChangeForApproval(prisma, session, project.id, change, false);
          } catch (error) {
            if (!(error instanceof ApiError)) throw error;
            reason = error.status === 409 ? "승인 기준 또는 검토 내용이 변경되었습니다. 담당자 재검토가 필요합니다." : "금액·기간 검토 확인 필요: 담당자 재검토 후 새 링크를 요청해주세요.";
          }
        }
      }
      // A past revision receipt always keeps its issued values, even after the draft is edited again.
      const impact = { ...(snapshot?.impact ?? calculated), phase, resultScope, canApprove: !receipt && phase === "waiting" && !reason, approvalBlockReason: reason };
      publicChange = {
        id: change.id, number: snapshot?.number ?? change.number, request: snapshot?.request ?? change.request,
        review: snapshot ? snapshot.review : publicChangeReview(change.review), amount: impact.amount.delta,
        status: receipt?.decision === "REVISE" ? "DRAFT" : receipt?.decision === "REJECT" ? "REJECTED" : change.status,
        approvedAt: phase === "approved" ? change.approvedAt : null, approvedBy: phase === "approved" ? change.approvedBy : null,
        resultScope: resultScope && change.resultScope ? { id: change.resultScope.id, majorVersion: change.resultScope.majorVersion, minorVersion: change.resultScope.minorVersion } : null,
        baseVersion: impact.baselineScope.version, baseDeadline: impact.completionDate.before, newDeadline: impact.completionDate.after, impact,
      };
    }
    return { receipt: token.feedback[0] ?? null, project: { name: project.name, status: project.status }, workspaceName: project.workspace.name, purpose: token.purpose, expiresAt: token.expiresAt, scope, change: publicChange, questions };
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
      await markEstimateForReview(tx, project.id);
      await tx.project.update({ where: { id: project.id }, data: { revision: { increment: 1 } } });
      return tx.clarificationAnswer.upsert({ where: { questionId }, create: { questionId, content, author }, update: { content, author } });
    });
  },
  async decide(raw: string, decision: "APPROVE" | "REVISE" | "REJECT", name: string, message: string, target?: ApprovalTarget) {
    const found = await this.token(raw);
    return prisma.$transaction(async (tx) => {
      await lockProject(tx, found.projectId);
      const token = await tx.clientAccessToken.findUnique({ where: { id: found.id }, include: { feedback: { select: { id: true } } } });
      if (!token || token.revokedAt || token.feedback.length || token.expiresAt <= new Date()) throw notFound("ACCESS_LINK_NOT_FOUND", "만료되었거나 처리된 공유 링크입니다.");
      const project = await tx.project.findUnique({ where: { id: token.projectId } });
      if (!project || project.deletedAt || ["COMPLETED", "CANCELLED"].includes(project.status)) throw new ApiError("PROJECT_LOCKED", "처리할 수 없는 프로젝트입니다.", 409);
      if (decision !== "APPROVE" && !message.trim()) throw new ApiError("MESSAGE_REQUIRED", "수정 요청 사유를 입력해주세요.", 422, { fieldErrors: [{ fieldPath: "message", message: "수정 요청 사유를 입력해주세요." }] });
      if (token.purpose === "SCOPE") {
        const scope = await tx.scope.findFirst({ where: { id: token.scopeId!, projectId: project.id } });
        if (!scope || scope.status !== "WAITING_APPROVAL") throw new ApiError("SCOPE_NOT_WAITING", "현재 승인 대기 중인 Scope가 아닙니다.", 409);
        if (decision === "REJECT") throw new ApiError("USE_REVISION_REQUEST", "Scope에는 수정 요청을 남겨주세요.", 422);
        if (decision === "APPROVE") {
          if (scope.basedOnRevision !== project.revision) throw new ApiError("SCOPE_STALE", "프로젝트가 변경되어 새 Scope가 필요합니다.", 409);
          await validateScopeForApproval(tx, { workspaceId: project.workspaceId, userId: "customer-approval", role: "OWNER" }, project.id, scope);
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
        const savedSnapshot = readChangeApprovalSnapshot(token.approvalSnapshot);
        if (token.approvalSnapshot != null && !savedSnapshot) throw new ApiError("APPROVAL_SNAPSHOT_CHANGED", "승인 스냅샷을 확인할 수 없습니다. 새 링크를 요청해주세요.", 409);
        const expectedId = savedSnapshot?.impact.approvalSnapshotId ?? `legacy:${token.id}`;
        const received = approvalTargetSchema.safeParse(target);
        if (!received.success) throw new ApiError("APPROVAL_TARGET_REQUIRED", "화면에 표시한 승인 대상 정보가 필요합니다. 페이지를 다시 확인해주세요.", 422);
        if (received.data.approvalSnapshotId !== expectedId || received.data.changeRequestId !== change.id || received.data.revision !== change.revision || savedSnapshot && savedSnapshot.targetFingerprint !== changeTargetFingerprint(change)) throw new ApiError("APPROVAL_SNAPSHOT_CHANGED", "승인 대상이 변경되었습니다. 담당자 재검토 후 새 링크를 요청해주세요.", 409);
        if (decision === "APPROVE") {
          const base = await tx.scope.findFirst({ where: { projectId: project.id, status: "APPROVED" }, include: { requirements: { orderBy: { position: "asc" } } }, orderBy: [{ majorVersion: "desc" }, { minorVersion: "desc" }] });
          if (!base || base.id !== change.baseScopeId) throw new ApiError("SCOPE_VERSION_CHANGED", "기준 Scope가 변경되어 재검토가 필요합니다.", 409);
          if (change.analysis) await requireFreshAIContext({ workspaceId: project.workspaceId, userId: "customer-approval", role: "OWNER" }, change.analysisContext as { inputFingerprint?: string; operation?: ProjectAIContext["operation"]; changeId?: string } ?? {}, project.id, tx);
          const checked = await validateChangeForApproval(tx, { workspaceId: project.workspaceId, userId: "customer-approval", role: "OWNER" }, project.id, change);
          const review = comparisonSchema.parse(change.review);
          const currentImpact = buildChangeApprovalImpact({ change, baseline: base, phase: "waiting", snapshotId: expectedId, datePolicy: "CALENDAR_DAYS_UTC" });
          if (savedSnapshot && (savedSnapshot.baselineFingerprint !== fingerprint(base.document) || impactValuesFingerprint(savedSnapshot.impact) !== impactValuesFingerprint(currentImpact))) throw new ApiError("APPROVAL_SNAPSHOT_CHANGED", "발급된 금액·기간 기준이 달라졌습니다. 새 링크를 요청해주세요.", 409);
          if (!currentImpact.canApprove) throw new ApiError("CHANGE_IMPACT_REVIEW_REQUIRED", currentImpact.approvalBlockReason!, 422);
          const impact = savedSnapshot?.impact ?? currentImpact;
          const added = [];
          for (const item of review.newRequirements) {
            const requirement = await tx.requirement.create({ data: { ...requirementInputSchema.parse(item), provenance: jsonValue({ implementation: item.implementation ?? null, sourceRefs: item.sourceRefs, customerApproved: true }), projectId: project.id, source: "CHANGE_REQUEST" } });
            await tx.changeRequestRequirement.create({ data: { changeRequestId: change.id, requirementId: requirement.id, snapshot: jsonValue(requirement) } });
            added.push(requirement);
          }
          const version = nextVersion(base);
          const document = structuredClone(base.document) as Record<string, unknown>;
          const previousRequirements = Array.isArray(document.requirements) ? document.requirements : [];
          document.requirements = [...previousRequirements, ...added.map(({ id, category, title, description, type, priority, source, provenance }) => ({ id, category, title, description, type, priority, source, implementation: (provenance as { implementation?: unknown }).implementation ?? null }))];
          document.description = review.scopeDescription ?? `${String(document.description ?? "")}\n\n변경 요청: ${change.request}`.trim();
          const estimate = typeof document.estimate === "object" && document.estimate ? document.estimate as Record<string, unknown> : {};
          const extraSubtotal = calculateAmount(review.estimatedWork, ratesSchema.parse(change.rates));
          document.estimate = { ...estimate, items: [...(Array.isArray(estimate.items) ? estimate.items : []), { requirementId: `CR-${change.number}`, title: `변경 요청 #${change.number}`, hours: review.estimatedWork, rates: change.rates, calculatedAmount: extraSubtotal, adjustmentReason: change.adjustmentReason ?? "", complexity: "MEDIUM", reason: review.reason, amount: change.amount }], subtotal: Number(estimate.subtotal ?? 0) + extraSubtotal, total: impact.amount.after };
          document.excluded = (Array.isArray(document.excluded) ? document.excluded : []).filter((item) => !review.removedExclusions.includes(String(item)));
          const exclusionReview = carryExclusions(readExclusionReview((base.validationReview as { exclusionReview?: unknown } | null)?.exclusionReview), review.removedExclusions, change.id, review.reason, "customer-approved-change");
          if (exclusionReview) { document.exclusions = publicExclusions(exclusionReview); document.excluded = publicExclusions(exclusionReview).map(i => i.title); }
          document.durationDays = impact.duration.afterDays;
          document.deadline = impact.completionDate.after;
          const approvedConditionChanges = review.reviewNotes?.constraints.filter(c => c.status === "explicit" && c.supersedes.length) ?? [];
          const retired = new Set(approvedConditionChanges.flatMap(c => c.supersedes));
          const scopeContext = { ...checked.context, operation: "SCOPE_SUMMARY" as const, explicitCustomerConstraints: [...checked.context.explicitCustomerConstraints.map(c => ({ ...c, active: c.active && !retired.has(c.id) })), ...approvedConditionChanges.map(c => ({ ...c, active: true }))], confirmedExcludedScope: checked.context.confirmedExcludedScope.filter(c => !retired.has(c.id)), approvedBaseline: { ...checked.context.approvedBaseline!, document: { ...(base.document as object), excluded: ((base.document as { excluded: string[] }).excluded).filter(title => !retired.has(excludedId(title))) } }, confirmedRequirements: [...checked.context.confirmedRequirements, ...added.map(r => ({ ...r, sourceRef: `requirement:${r.id}` }))], existingRequirements: [...checked.context.existingRequirements, ...added.map(r => ({ id: r.id, title: r.title, status: r.status }))] };
          const expectedScope = { total: impact.amount.after!, durationDays: impact.duration.afterDays, items: (document.estimate as { items: unknown[] }).items, deadline: impact.completionDate.after };
          const validDocument = validateAIResult(scopeContext, document, { kind: "SCOPE", ...(exclusionReview ? { exclusionReview } : {}), expectedScope, acknowledgements: checked.state?.acknowledgements });
          requireValidated(validDocument);
          const created = await tx.scope.create({ data: { projectId: project.id, ...version, status: "APPROVED", document: jsonValue(document), validationReview: jsonValue({ ...initialReview(scopeContext, document, validDocument), expectedScope, ...(exclusionReview ? { exclusionReview } : {}), approvedConditionChanges: [...((base.validationReview as { approvedConditionChanges?: unknown[] } | null)?.approvedConditionChanges ?? []), ...approvedConditionChanges] }), basedOnRevision: project.revision + 1, approvedAt: new Date(), approvedBy: name, requirements: { create: [...base.requirements.map((item) => ({ requirementId: item.requirementId, snapshot: item.snapshot as Prisma.InputJsonValue, position: item.position })), ...added.map((item, index) => ({ requirementId: item.id, snapshot: jsonValue(item), position: base.requirements.length + index }))] } } });
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
