import { z } from "zod";
import type { AIAction, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/errors";
import type { SessionContext } from "@/lib/auth/session";
import { calculateAmount, conditionSchema, exclusionSchema, hoursSchema, ratesSchema, resolutionSchema, reviewNotesSchema, initialAnalysisSchema, questionsResultSchema, requirementsResultSchema, estimateResultSchema, scopeAIResultSchema, comparisonSchema } from "@/lib/model";
import { prompts } from "@/lib/ai/prompts";
import { audit, lockProject, projectFor, type Db } from "./shared";
import { fingerprint } from "@/lib/fingerprint";
import { prepareExclusions, readExclusionReview, sameExclusion, exclusionKind } from "@/lib/scope-exclusions";
import { sourceConditions } from "@/lib/customer-conditions";
export { fingerprint } from "@/lib/fingerprint";

export const jsonValue = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export type SourceReference = { id: string; label: string; text: string; revision: string; kind: string };
export type ContextIssue = z.infer<typeof reviewNotesSchema>["unresolvedItems"][number];
type Decision = z.infer<typeof resolutionSchema> & { evidenceRefs: string[]; description: string; sourceFingerprint: string; actor: string; createdAt: string };
const storedSchema = z.object({ constraints: z.array(conditionSchema).default([]), excludedScope: z.array(exclusionSchema.extend({ extractionRunId: z.string().uuid().optional() })).default([]), retiredExclusions: z.array(z.string()).default([]), decisions: z.array(z.object({ id: z.string(), description: z.string(), reason: z.string(), sourceRefs: z.array(z.string()), sourceFingerprint: z.string(), actor: z.string(), createdAt: z.string() })).default([]) });
export const readContextReview = (value: unknown) => storedSchema.parse(value ?? {});
export const excludedId = (title: string) => `excluded:${fingerprint(title).slice(0, 16)}`;
const issueFingerprint = (issue: Pick<ContextIssue, "description" | "sourceRefs">, sources: SourceReference[]) => fingerprint({ description: issue.description, sources: issue.sourceRefs.map(id => sources.find(s => s.id === id)) });

export async function buildProjectAIContext(session: SessionContext, projectId: string, operation: AIAction, options: { db?: Db; changeId?: string } = {}) {
  if (options.db) return collectProjectAIContext(session, projectId, operation, { ...options, db: options.db });
  return prisma.$transaction(async db => {
    await lockProject(db, projectId);
    return collectProjectAIContext(session, projectId, operation, { ...options, db });
  }, { isolationLevel: "RepeatableRead", timeout: 15000 });
}
async function collectProjectAIContext(session: SessionContext, projectId: string, operation: AIAction, options: { db: Db; changeId?: string }) {
  const db = options.db;
  const project = await projectFor(session, projectId, db);
  await db.$queryRaw`SELECT id FROM rate_cards WHERE "workspaceId" = ${session.workspaceId}::uuid FOR SHARE`;
  const [request, questions, requirements, estimate, scopes, card, change] = await Promise.all([
    db.initialRequest.findUnique({ where: { projectId } }),
    db.clarificationQuestion.findMany({ where: { projectId }, include: { answer: true }, orderBy: [{ position: "asc" }, { id: "asc" }] }),
    db.requirement.findMany({ where: { projectId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    db.estimate.findUnique({ where: { projectId }, include: { items: { orderBy: { requirementId: "asc" } } } }),
    db.scope.findMany({ where: { projectId }, orderBy: [{ majorVersion: "desc" }, { minorVersion: "desc" }] }),
    db.rateCard.findUnique({ where: { workspaceId: session.workspaceId } }),
    options.changeId ? db.changeRequest.findFirst({ where: { id: options.changeId, projectId } }) : null,
  ]);
  if (options.changeId && !change) throw new ApiError("CHANGE_NOT_FOUND", "변경 요청을 찾을 수 없습니다.", 404);
  const latest = scopes.find(s => s.status === "APPROVED");
  const baseline = change ? scopes.find(s => s.id === change.baseScopeId && s.status === "APPROVED") : latest;
  if (operation === "SCOPE_COMPARISON" && (!change || !baseline)) throw new ApiError("APPROVED_BASELINE_REQUIRED", "지정된 승인 Scope가 필요합니다.", 409);
  const draftScope = scopes.find(s => s.status === "DRAFT");
  const document = draftScope?.document as { excluded?: string[]; assumptions?: string[]; integrations?: string[]; durationDays?: number } | undefined;
  const sources: SourceReference[] = [];
  const source = (id: string, label: string, text: string, revision: string, kind: string) => { sources.push({ id, label, text, revision, kind }); return id; };
  const history = z.array(z.object({ content: z.string(), revision: z.string(), actor: z.string() })).catch([]).parse(request?.history ?? []);
  const requestRef = request ? source(`request:${request.id}`, "고객 원문 · 현재 적용 내용", request.content, request.updatedAt.toISOString(), "REQUEST") : null;
  // Texts occur once in sources; request/history references preserve every original revision.
  const requestHistory = history.map((h, i) => ({ revision: h.revision, actor: h.actor, sourceRef: source(`request:${request!.id}:history:${i}`, `고객 원문 · 이전 수정 ${i + 1}`, h.content, h.revision, "REQUEST_HISTORY") }));
  const originalRequest = request ? { id: request.id, sourceRef: requestRef, originalSourceRef: requestHistory[0]?.sourceRef ?? requestRef, history: requestHistory } : null;
  const savedAnswers = questions.flatMap(q => q.answer ? [{ questionId: q.id, answerId: q.answer.id, question: q.question, answer: q.answer.content, author: q.answer.author, sourceRef: source(`answer:${q.answer.id}`, `고객 답변 · ${q.question}`, `${q.question}\n${q.answer.content}`, q.answer.updatedAt.toISOString(), "ANSWER") }] : []);
  const existingQuestions = questions.map(q => ({ id: q.id, question: q.question, reason: q.reason, important: q.important, answered: !!q.answer, sourceRef: source(`question:${q.id}`, `질문 · ${q.question}`, `${q.question}\n${q.reason}`, fingerprint([q.question, q.reason, q.important]), "QUESTION") }));
  const confirmedRequirements = requirements.filter(r => r.status === "CONFIRMED").map(r => ({ id: r.id, category: r.category, title: r.title, description: r.description, type: r.type, priority: r.priority, source: r.source, sourceRef: source(`requirement:${r.id}`, `확정 요구사항 · ${r.title}`, `${r.title}\n${r.description}`, r.updatedAt.toISOString(), "REQUIREMENT"), provenance: r.provenance }));
  const review = readContextReview(project.contextReview);
  const approvedConditions = z.array(conditionSchema).catch([]).parse((baseline?.validationReview as { approvedConditionChanges?: unknown } | null)?.approvedConditionChanges ?? []);
  if (baseline) { const doc = baseline.document as { description?: string; excluded?: string[]; estimate?: { total: number }; durationDays?: number }; source(`scope:${baseline.id}`, `승인 Scope v${baseline.majorVersion}.${baseline.minorVersion}`, `${approvedConditions.map(c => c.evidence).join("\n")}\n${JSON.stringify({ description: doc.description, excluded: doc.excluded, total: doc.estimate?.total, durationDays: doc.durationDays })}`, `${baseline.majorVersion}.${baseline.minorVersion}`, "APPROVED_SCOPE"); }
  const retired = new Set([...review.constraints, ...approvedConditions].flatMap(c => c.supersedes));
  let explicitCustomerConstraints = [...sourceConditions(sources), ...review.constraints, ...approvedConditions.map(c => ({ ...c, sourceRefs: [`scope:${baseline!.id}`] }))].filter((c, i, all) => all.findIndex(v => v.id === c.id) === i).map(c => ({ ...c, active: !retired.has(c.id) }));
  let confirmedExcludedScope = [
    ...review.excludedScope.filter(e => e.status === "explicit" && !review.retiredExclusions.includes(excludedId(e.title))).map(e => ({ id: excludedId(e.title), ...e })),
    ...requirements.filter(r => r.status === "EXCLUDED").map(r => ({ id: excludedId(r.title), title: r.title, sourceRefs: [source(`requirement:${r.id}`, `담당자 제외 · ${r.title}`, `${r.title}\n${r.description}`, r.updatedAt.toISOString(), "EXCLUDED_REQUIREMENT")] })),
    ...(document?.excluded ?? []).map(title => ({ id: excludedId(title), title, sourceRefs: [source(`scope-excluded:${draftScope!.id}:${excludedId(title)}`, `Scope 초안 제외 · ${title}`, title, String(draftScope!.basedOnRevision), "SCOPE_DRAFT")] })),
    ...((baseline?.document as { excluded?: string[] } | undefined)?.excluded ?? []).map(title => ({ id: excludedId(title), title, sourceRefs: [source(`scope-excluded:${baseline!.id}:${excludedId(title)}`, `승인 Scope 제외 · ${title}`, title, `${baseline!.majorVersion}.${baseline!.minorVersion}`, "APPROVED_SCOPE")] })),
  ].filter((e, index, all) => !review.retiredExclusions.includes(e.id) && !approvedConditions.some(c => c.supersedes.includes(e.id)) && all.findIndex(v => v.title === e.title) === index);
  const unresolvedItems: ContextIssue[] = [
    ...existingQuestions.filter(q => !q.answered).map(q => ({ id: `question:${q.id}`, description: `저장된 답변이 필요합니다: ${q.question}`, sourceRefs: [q.sourceRef], important: q.important })),
    ...requirements.filter(r => r.status === "PENDING").map(r => ({ id: `pending:${r.id}`, description: `요구사항을 확인해주세요: ${r.title}`, sourceRefs: [source(`requirement:${r.id}`, `확인 필요 요구사항 · ${r.title}`, `${r.title}\n${r.description}`, r.updatedAt.toISOString(), "PENDING_REQUIREMENT")], important: true })),
    ...explicitCustomerConstraints.filter(c => c.active && (c.status === "pending" || !c.sourceRefs.some(ref => sources.find(s => s.id === ref)?.text.includes(c.evidence)))).map(c => ({ id: `condition:${c.id}`, description: `조건의 근거가 변경되었거나 확인이 필요합니다: ${c.key} = ${c.value}`, sourceRefs: c.sourceRefs.filter(ref => sources.some(s => s.id === ref)), important: true })),
  ];
  if (change) source(`change:${change.id}`, `변경 요청 #${change.number}`, change.request, fingerprint(change.request), "CHANGE_REQUEST");
  const rates = estimate ? ratesSchema.parse(estimate.rates) : card ? ratesSchema.parse(card.rates) : null;
  const items = (estimate?.items ?? []).filter(i => confirmedRequirements.some(r => r.id === i.requirementId)).map(i => ({ requirementId: i.requirementId, hours: hoursSchema.parse(i.hours), implementation: i.implementation, complexity: i.complexity, reason: i.reason, reviewed: i.reviewed }));
  const subtotal = rates ? items.reduce((sum, i) => sum + calculateAmount(i.hours, rates), 0) : 0;
  const confirmedEstimate = estimate && rates ? { id: estimate.id, rates, items, subtotal, total: estimate.overrideTotal ?? subtotal, overrideTotal: estimate.overrideTotal, adjustmentReason: estimate.adjustmentReason, reviewed: items.every(i => i.reviewed), durationDays: document?.durationDays ?? null, sourceRef: source(`estimate:${estimate.id}`, "담당자 저장 견적 · 확정 금액과 기간", JSON.stringify({ rates, subtotal, total: estimate.overrideTotal ?? subtotal, adjustmentReason: estimate.adjustmentReason, durationDays: document?.durationDays ?? null }), estimate.updatedAt.toISOString(), "ESTIMATE") } : null;
  const exclusionScope = draftScope ?? scopes.find(s => s.status === "WAITING_APPROVAL") ?? baseline;
  const exclusionReview = readExclusionReview((exclusionScope?.validationReview as { exclusionReview?: unknown } | null)?.exclusionReview);
  const scopeExclusions = prepareExclusions(sources, [...review.excludedScope, ...requirements.filter(r => r.status === "EXCLUDED").map(r => ({ title: r.title, status: "explicit", evidence: `${r.title}\n${r.description}`, sourceRefs: [`requirement:${r.id}`] }))], exclusionReview, (exclusionScope?.document as { excluded?: string[] } | undefined)?.excluded ?? []);
  for (const exclusion of scopeExclusions.items) {
    const replacement = explicitCustomerConstraints.find(c => c.active && c.status === "explicit" && c.supersedes.length && (c.value === true || c.value === "included") && exclusionKind(c.key) === exclusionKind(exclusion.title) && !!exclusionKind(exclusion.title) && c.sourceRefs.some(ref => sources.find(s => s.id === ref)?.text.includes(c.evidence)));
    if (replacement) { exclusion.state = "superseded"; exclusion.resolutionReason = "검토된 후속 고객 조건: " + replacement.evidence; exclusion.resolutionSourceRefs = replacement.sourceRefs; exclusion.resolutionEvidence = replacement.sourceRefs.flatMap(ref => { const s = sources.find(s => s.id === ref); return s ? [{ sourceRef: ref, revision: s.revision, quote: replacement.evidence }] : []; }); }
  }
  const retiredExclusions = scopeExclusions.items.filter(e => ["superseded", "dismissed"].includes(e.state) && (e.explicit || e.resolutionReason) && !scopeExclusions.items.some(other => other.state === "active" && sameExclusion(other.title, e.title)));
  confirmedExcludedScope = [...confirmedExcludedScope.filter(e => !retiredExclusions.some(r => sameExclusion(r.title, e.title))), ...scopeExclusions.items.filter(e => e.explicit && !["superseded", "dismissed"].includes(e.state) && !review.retiredExclusions.includes(e.id) && !approvedConditions.some(c => c.supersedes.includes(e.id))).map(e => ({ id: e.id, title: e.title, sourceRefs: e.sourceRefs }))].filter((e, i, all) => all.findIndex(v => sameExclusion(v.title, e.title)) === i);
  explicitCustomerConstraints = explicitCustomerConstraints.map(c => ({ ...c, active: c.active && !retiredExclusions.some(e => exclusionKind(e.title) && exclusionKind(e.title) === exclusionKind(c.key) && (c.value === false || c.value === "excluded")) }));
  const ownerDecisions = review.decisions.filter(d => d.sourceFingerprint === issueFingerprint(d, sources));
  const applicableIssues = unresolvedItems.filter(i => !ownerDecisions.some(d => d.id === i.id && d.sourceFingerprint === issueFingerprint({ ...i, sourceRefs: [...new Set([...i.sourceRefs, ...d.sourceRefs])] }, sources)));
  const base = {
    scopeExclusions,
    schemaVersion: 1, workspaceId: session.workspaceId, projectId, operation, promptVersion: prompts[operation].version,
    project: { name: project.name, budget: project.budget, deadline: project.deadline?.toISOString().slice(0, 10) ?? null, notes: project.notes },
    originalRequest, savedAnswers, existingQuestions, confirmedRequirements, existingRequirements: requirements.map(r => ({ id: r.id, title: r.title, status: r.status })), confirmedIncludedScope: confirmedRequirements.map(r => ({ requirementId: r.id, title: r.title, sourceRefs: [r.sourceRef] })), confirmedExcludedScope,
    explicitCustomerConstraints, ownerDecisions: ownerDecisions.map(({ id, description, reason, sourceRefs }) => ({ id, description, reason, sourceRefs })), confirmedEstimate, rateCard: card?.rates ?? null,
    scopeDraft: draftScope ? { id: draftScope.id, basedOnRevision: draftScope.basedOnRevision, document: (({ description, excluded, assumptions, integrations, deliverables, durationDays }) => ({ description, excluded, assumptions, integrations, deliverables, durationDays }))(draftScope.document as Record<string, unknown>) } : null,
    approvedBaseline: baseline ? { id: baseline.id, version: `${baseline.majorVersion}.${baseline.minorVersion}`, document: baseline.document, isCurrent: latest?.id === baseline.id } : null,
    changeRequest: change ? { id: change.id, request: change.request, baseScopeId: change.baseScopeId, rates: change.rates } : null,
    // Full customer data stays above; don't repeat the whole model response and its evidence.
    appliedAnalysis: request?.analysis ? (({ projectType, summary, missingInformation }) => ({ projectType, summary, missingInformation }))(request.analysis as { projectType: string; summary: string; missingInformation: unknown }) : null, unresolvedItems: applicableIssues, sources,
  };
  return { ...base, inputFingerprint: fingerprint(base) };
}
export type ProjectAIContext = Awaited<ReturnType<typeof buildProjectAIContext>>;
export function contextForOperation(context: ProjectAIContext, operation: AIAction) {
  const base = { ...context }; delete (base as Partial<ProjectAIContext>).inputFingerprint;
  const input = { ...base, operation, promptVersion: prompts[operation].version };
  return { ...input, inputFingerprint: fingerprint(input) };
}
export const changedContext = () => new ApiError("AI_CONTEXT_CHANGED", "AI 실행 후 고객 답변 또는 범위가 변경되었습니다. 최신 내용으로 다시 검토해주세요.", 409);
export function isFreshAIContext(current: ProjectAIContext, saved: { inputFingerprint?: string; context?: unknown }) {
  if (saved.inputFingerprint === current.inputFingerprint) return true;
  if (!saved.context || typeof saved.context !== "object") return false;
  const old = { ...saved.context as Record<string, unknown> }; delete old.inputFingerprint;
  if (fingerprint(old) !== saved.inputFingerprint) return false;
  const now = { ...current } as Partial<ProjectAIContext>; delete now.inputFingerprint;
  // Prompt upgrades change cache keys, but do not require another paid call for unchanged evidence.
  delete old.promptVersion; delete now.promptVersion;
  return fingerprint(old) === fingerprint(now);
}
export async function requireFreshAIContext(session: SessionContext, saved: { inputFingerprint?: string; operation?: AIAction; changeId?: string; context?: unknown }, projectId: string, db: Db) {
  if (!saved.inputFingerprint || !saved.operation) throw new ApiError("AI_CONTEXT_UNVERIFIED", "이전 실행의 입력 기준 확인 불가: 새 정책으로 다시 분석해주세요.", 409);
  const current = await buildProjectAIContext(session, projectId, saved.operation, { db, changeId: saved.changeId });
  if (!isFreshAIContext(current, saved)) throw changedContext();
  if (current.approvedBaseline && !current.approvedBaseline.isCurrent) throw new ApiError("SCOPE_VERSION_CHANGED", "기준 Scope가 변경되었습니다. 최신 승인 범위에서 재비교해주세요.", 409);
  return current;
}

export function validateContextResult(value: unknown, context: ProjectAIContext) {
  const result = value as Record<string, unknown>;
  const notes = reviewNotesSchema.parse(result.reviewNotes);
  const refs = new Set(context.sources.map(s => s.id));
  const check = (ids: string[], required = false) => {
    if ((required && !ids.length) || ids.some(id => !refs.has(id))) throw new ApiError("AI_INVALID_SOURCE", "AI 근거에 존재하지 않는 출처가 포함되어 있습니다.", 502);
  };
  check(notes.sourceRefs, true);
  for (const item of [...notes.assumptions, ...notes.unresolvedItems, ...notes.proposedChanges]) check(item.sourceRefs);
  for (const item of notes.proposedChanges) if (item.requirementId && !context.existingRequirements.some(r => r.id === item.requirementId)) throw new ApiError("AI_INVALID_SOURCE", "변경 제안에 존재하지 않는 요구사항이 있습니다.", 502);
  const supersedes = new Set([...context.explicitCustomerConstraints.map(c => c.id), ...context.confirmedExcludedScope.map(e => e.id)]);
  for (const item of [...notes.constraints, ...notes.excludedScope]) {
    check(item.sourceRefs, true);
    if (!item.sourceRefs.some(id => context.sources.find(s => s.id === id)?.text.includes(item.evidence))) throw new ApiError("AI_INVALID_SOURCE", "고객 조건의 근거 문장을 확인할 수 없습니다.", 502);
    if ("supersedes" in item && item.supersedes.some(id => !supersedes.has(id))) throw new ApiError("AI_INVALID_SOURCE", "대체할 기존 조건을 찾을 수 없습니다.", 502);
    if ("supersedes" in item) {
      const previous = context.explicitCustomerConstraints.find(c => c.id === item.id);
      if (item.supersedes.includes(item.id) || (previous && (previous.key !== item.key || previous.value !== item.value || fingerprint([...previous.supersedes].sort()) !== fingerprint([...item.supersedes].sort())))) throw new ApiError("AI_INVALID_SOURCE", "조건을 수정하려면 새 조건 ID로 이전 조건을 명시적으로 대체해주세요.", 502);
    }
  }
  for (const name of ["features", "requirements", "items", "questions", "newRequirements"]) {
    const items = result[name];
    if (Array.isArray(items)) for (const item of items as { sourceRefs?: string[]; requirementId?: string; existingRequirementId?: string | null; change?: string }[]) {
      check(item.sourceRefs ?? [], true);
      if (item.requirementId && !context.confirmedRequirements.some(r => r.id === item.requirementId)) throw new ApiError("AI_INVALID_SOURCE", "확정되지 않은 요구사항의 작업량입니다.", 502);
      if (item.existingRequirementId && !context.existingRequirements.some(r => r.id === item.existingRequirementId)) throw new ApiError("AI_INVALID_SOURCE", "기존 요구사항을 찾을 수 없습니다.", 502);
      if (name === "requirements" && item.change !== "ADD" && !item.existingRequirementId) throw new ApiError("AI_INVALID_SOURCE", "수정·제외할 기존 요구사항이 필요합니다.", 502);
      if (name === "requirements" && item.change === "ADD" && item.existingRequirementId) throw new ApiError("AI_INVALID_SOURCE", "신규 제안을 기존 요구사항으로 덮어쓸 수 없습니다.", 502);
    }
  }
  if (context.operation === "ESTIMATE") {
    const items = result.items as { requirementId: string }[];
    const ids = context.confirmedRequirements.map(r => r.id);
    if (items.length !== ids.length || new Set(items.map(i => i.requirementId)).size !== ids.length) throw new ApiError("INVALID_ESTIMATE", "확정 요구사항마다 작업량이 한 번씩 필요합니다.", 502);
  }
  if (context.operation === "SCOPE_COMPARISON") {
    const baseline = context.approvedBaseline?.document as { requirements?: { id: string }[]; excluded?: string[] };
    if ((result.affectedExistingRequirements as string[]).some(id => !baseline.requirements?.some(r => r.id === id)) || (result.removedExclusions as string[]).some(item => !baseline.excluded?.includes(item))) throw new ApiError("AI_INVALID_SOURCE", "지정 승인 Scope에 없는 항목입니다.", 502);
  }
  return notes;
}

export function reviewIssues(context: ProjectAIContext, value: unknown) {
  const parsed = reviewNotesSchema.safeParse((value as { reviewNotes?: unknown })?.reviewNotes);
  const notes = parsed.success ? parsed.data : undefined;
  return [...context.unresolvedItems, ...(notes?.assumptions ?? []), ...(notes?.unresolvedItems ?? []), ...(notes?.constraints.filter(c => c.status === "pending").map(c => ({ id: `condition:${c.id}`, description: `${c.key} = ${c.value}`, important: true, sourceRefs: c.sourceRefs })) ?? []), ...(notes?.excludedScope.filter(e => e.status === "pending").map(e => ({ id: excludedId(e.title), description: `제외 여부 확인: ${e.title}`, important: true, sourceRefs: e.sourceRefs })) ?? [])].filter((v, i, all) => all.findIndex(x => x.id === v.id) === i);
}
export async function recordAIReview(db: Db, session: SessionContext, context: ProjectAIContext, value: unknown, original: unknown, resolutions: unknown, reason = "", extractionRunId?: string) {
  const decisions = z.array(resolutionSchema).max(80).parse(resolutions ?? []);
  const issues = [...reviewIssues(context, original), ...reviewIssues(context, value)];
  if (!["INITIAL_ANALYSIS", "QUESTIONS"].includes(context.operation)) {
    const missing = issues.filter(i => i.important && !decisions.some(d => d.id === i.id && d.reason.trim() && d.sourceRefs.length));
    if (missing.length) throw new ApiError("AI_REVIEW_REQUIRED", `중요한 조건을 먼저 확인해주세요: ${missing[0].description}`, 409);
  }
  const schema = { INITIAL_ANALYSIS: initialAnalysisSchema, QUESTIONS: questionsResultSchema, REQUIREMENTS: requirementsResultSchema, ESTIMATE: estimateResultSchema, SCOPE_SUMMARY: scopeAIResultSchema, SCOPE_COMPARISON: comparisonSchema }[context.operation];
  const parsedOriginal = schema.safeParse(original); const parsedCandidate = schema.safeParse(value);
  if (fingerprint(parsedCandidate.success ? parsedCandidate.data : value) !== fingerprint(parsedOriginal.success ? parsedOriginal.data : original) && !reason.trim()) throw new ApiError("AI_REVIEW_REASON_REQUIRED", "초안 내용 또는 고객 조건을 수정한 사유를 입력해주세요.", 422);
  const stored = readContextReview((await projectFor(session, context.projectId, db)).contextReview);
  const accepted: Decision[] = decisions.map(d => {
    const issue = issues.find(i => i.id === d.id);
    if (!issue || d.sourceRefs.some(id => !context.sources.some(s => s.id === id))) throw new ApiError("INVALID_RESOLUTION", "조건 해소 근거를 확인해주세요.", 422);
    const sourceRefs = [...new Set([...issue.sourceRefs, ...d.sourceRefs])];
    return { ...d, sourceRefs, evidenceRefs: d.sourceRefs, description: issue.description, sourceFingerprint: issueFingerprint({ ...issue, sourceRefs }, context.sources), actor: session.userId, createdAt: new Date().toISOString() };
  });
  const notes = reviewNotesSchema.parse((value as { reviewNotes: unknown }).reviewNotes);
  const replaced = notes.constraints.flatMap(c => c.supersedes);
  if (replaced.length && !reason.trim()) throw new ApiError("AI_REVIEW_REASON_REQUIRED", "기존 고객 조건을 대체하는 사유를 입력해주세요.", 422);
  // Approval changes have their own review/audit trail; never rewrite original project conditions.
  if (context.operation !== "SCOPE_COMPARISON") await db.project.update({ where: { id: context.projectId }, data: { contextReview: jsonValue({ constraints: [...stored.constraints.filter(c => !notes.constraints.some(n => n.id === c.id)), ...notes.constraints], excludedScope: [...stored.excludedScope.filter(e => !notes.excludedScope.some(n => n.title === e.title)), ...notes.excludedScope.map(e => ({ ...e, ...(extractionRunId ? { extractionRunId } : {}) }))], retiredExclusions: [...new Set([...stored.retiredExclusions, ...replaced.filter(id => id.startsWith("excluded:"))])], decisions: [...stored.decisions.filter(d => !accepted.some(n => n.id === d.id)), ...accepted] }) } });
  await audit(db, session, "AI_CONTEXT_REVIEWED", context.operation === "SCOPE_COMPARISON" ? "ChangeRequest" : "Project", context.changeRequest?.id ?? context.projectId, context.projectId, jsonValue({ inputFingerprint: context.inputFingerprint, reason, decisions: accepted, supersedes: replaced, sourceRefs: notes.sourceRefs }));
}

export async function markEstimateForReview(db: Db, projectId: string) {
  await db.estimateItem.updateMany({ where: { estimate: { projectId } }, data: { reviewed: false } });
}
