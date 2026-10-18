export type ValidationIssue = { issueId: string; issueFingerprint: string; ruleId: string; severity: "ERROR" | "WARNING" | "REVIEW_REQUIRED"; fieldPaths: string[]; message: string; sourceRefs: string[]; evidence: unknown; suggestions: string[] };
export type ValidationResult = { status: "blocked" | "review_required" | "passed" | "passed_with_warnings"; ruleSetVersion: string; contextFingerprint: string; candidateRevision: number; issues: ValidationIssue[] };
export type WarningInput = { issueId: string; issueFingerprint: string; reason: string };
export type ReviewState = { impact?: import("./change-approval-impact").ChangeApprovalImpact; candidate?: unknown; candidateRevision: number; validation: ValidationResult; acknowledgements?: WarningInput[]; history?: { candidateRevision: number; candidate: unknown; changedPaths: string[]; savedAt: string }[] };
export const canFinalize = (validation?: ValidationResult) => !!validation && ["passed", "passed_with_warnings"].includes(validation.status);
// A late response can advance the saved revision, but cannot validate a newer local edit.
export const matchesReviewedCandidate = (submitted: string, current: string, responseRevision: number, expectedRevision: number) => submitted === current && responseRevision > expectedRevision;
export const reviewSnapshotKey = (id: string, state: Partial<ReviewState>) => JSON.stringify([id, state.candidateRevision, state.validation?.contextFingerprint, state.validation?.ruleSetVersion, state.validation?.status, state.validation?.issues.map(i => i.issueFingerprint)]);
