import { z } from "zod";
import { ApiError } from "@/lib/errors";
import { fingerprint } from "@/lib/fingerprint";
import { validateAIResult, warningInputSchema, type ValidationPolicy, type ValidationResult, type WarningAcknowledgement } from "@/lib/ai/rule-validator";
import type { ProjectAIContext } from "./ai-context.service";
import { jsonValue } from "./ai-context.service";
import { audit, type Db } from "./shared";
import type { SessionContext } from "@/lib/auth/session";

export type ReviewState = {
  candidate: unknown; candidateRevision: number; validation: ValidationResult;
  acknowledgements: WarningAcknowledgement[]; explanationBasis: unknown;
  history: { candidateRevision: number; candidate: unknown; changedPaths: string[]; validation: ValidationResult; acknowledgements: WarningAcknowledgement[]; actor: string; savedAt: string }[];
};
export function initialReview(context: ProjectAIContext, candidate: unknown, validation = validateAIResult(context, candidate)): ReviewState {
  return { candidate, candidateRevision: 0, validation, acknowledgements: [], explanationBasis: candidate, history: [] };
}
export function assertCandidateRevision(state: Partial<ReviewState> | null | undefined, expected = 0) {
  if ((state?.candidateRevision ?? 0) !== expected) throw new ApiError("AI_CANDIDATE_CHANGED", "검토 초안 리비전이 변경되었습니다. 최신 초안을 확인해주세요.", 409);
}
export function requireValidated(validation: ValidationResult) {
  if (!["passed", "passed_with_warnings"].includes(validation.status)) throw new ApiError("AI_RESULT_VALIDATION_FAILED", "검증 이슈를 수정하거나 필요한 근거를 보완한 뒤 다시 검증해주세요.", 422, { validation });
}
export function revalidate(context: ProjectAIContext, candidate: unknown, state: Partial<ReviewState> | null | undefined, policy: ValidationPolicy = {}) {
  return validateAIResult(context, candidate, { ...policy, candidateRevision: policy.candidateRevision ?? state?.candidateRevision ?? 0, previousCandidate: state?.explanationBasis ?? state?.candidate ?? candidate, acknowledgements: state?.acknowledgements ?? [] });
}
const object = (v: unknown) => v && typeof v === "object" ? v as Record<string, unknown> : {};
function changedPaths(before: unknown, after: unknown, prefix = ""): string[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (!before || !after || typeof before !== "object" || typeof after !== "object") return [prefix || "result"];
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap(key => changedPaths(object(before)[key], object(after)[key], prefix ? `${prefix}.${key}` : key));
}
function explanationBasis(previous: unknown, candidate: unknown, validation: ValidationResult, accepted: WarningAcknowledgement[]) {
  const before = object(previous); const current = object(candidate);
  const confirmed = (path: string) => validation.issues.some(i => i.severity === "WARNING" && i.fieldPaths.includes(path) && accepted.some(a => a.issueFingerprint === i.issueFingerprint));
  if (Array.isArray(current.items)) return { ...before, items: current.items.map((raw, i) => {
    const item = object(raw); const old = (Array.isArray(before.items) ? before.items : []).map(object).find(v => v.requirementId === item.requirementId) ?? item;
    return item.reason !== old.reason || confirmed(`items.${i}.reason`) ? item : old;
  }) };
  if (current.reason !== before.reason || confirmed("reason") || current.description !== before.description || confirmed("description")) return candidate;
  return previous;
}
export async function saveReviewState(db: Db, session: SessionContext, context: ProjectAIContext, candidate: unknown, original: unknown, previous: Partial<ReviewState> | null | undefined, requestedWarnings: unknown, policy: ValidationPolicy = {}, entity: { type: string; id: string; runId?: string }) {
  const candidateRevision = (previous?.candidateRevision ?? 0) + 1;
  const validation = revalidate(context, candidate, previous, { ...policy, candidateRevision });
  const requested = z.array(warningInputSchema).max(100).parse(requestedWarnings ?? []);
  const accepted = (previous?.acknowledgements ?? []).filter(a => validation.issues.some(i => i.severity === "WARNING" && i.issueId === a.issueId && i.issueFingerprint === a.issueFingerprint));
  for (const request of requested) {
    const issue = validation.issues.find(i => i.issueId === request.issueId && i.issueFingerprint === request.issueFingerprint && i.severity === "WARNING");
    if (!issue) throw new ApiError("INVALID_WARNING_ACKNOWLEDGEMENT", "오류·판별 불가 이슈는 확인으로 면제할 수 없습니다. 최신 경고를 다시 확인해주세요.", 422, { validation });
    const acknowledgement: WarningAcknowledgement = { ...request, userId: session.userId, confirmedAt: new Date().toISOString(), candidateRevision, contextFingerprint: context.inputFingerprint, ruleSetVersion: validation.ruleSetVersion };
    const index = accepted.findIndex(a => a.issueId === issue.issueId); if (index >= 0) accepted[index] = acknowledgement; else accepted.push(acknowledgement);
  }
  const validated = validateAIResult(context, candidate, { ...policy, candidateRevision, previousCandidate: previous?.explanationBasis ?? previous?.candidate ?? original, acknowledgements: accepted });
  const state: ReviewState = { candidate, candidateRevision, validation: validated, acknowledgements: accepted, explanationBasis: explanationBasis(previous?.explanationBasis ?? original, candidate, validated, accepted), history: [...(previous?.history ?? []), { candidateRevision, candidate, changedPaths: changedPaths(previous?.candidate ?? original, candidate), validation: validated, acknowledgements: accepted.filter(a => validated.issues.some(i => i.issueFingerprint === a.issueFingerprint)), actor: session.userId, savedAt: new Date().toISOString() }] };
  if (entity.runId) await db.aIUsage.update({ where: { id: entity.runId }, data: { reviewHistory: jsonValue(state.history) } });
  await audit(db, session, "AI_RULE_REVIEW_SAVED", entity.type, entity.id, context.projectId, jsonValue({ ...state.history.at(-1), originalFingerprint: fingerprint(original) }));
  return state;
}
export async function auditValidation(db: Db, session: SessionContext, context: ProjectAIContext, candidate: unknown, validation: ValidationResult, state: Partial<ReviewState> | null | undefined, type: string, id: string) {
  await db.auditLog.create({ data: { workspaceId: session.workspaceId, projectId: context.projectId, ...(session.userId !== "customer-approval" ? { userId: session.userId } : {}), event: "AI_RULE_VALIDATED", entityType: type, entityId: id, metadata: jsonValue({ actorKind: session.userId === "customer-approval" ? "CUSTOMER_LINK" : "OWNER", validation, candidate, acknowledgements: state?.acknowledgements ?? [], candidateFingerprint: fingerprint(candidate) }) } });
}
