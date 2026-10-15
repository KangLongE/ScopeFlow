import { z } from "zod";
import { addDays, comparisonSchema, moneySchema } from "./model";
import { fingerprint } from "./fingerprint";

export const approvalTargetSchema = z.object({ approvalSnapshotId: z.string().min(1).max(200), changeRequestId: z.string().uuid(), revision: z.number().int().min(0) });
export type ApprovalTarget = z.infer<typeof approvalTargetSchema>;
export type ImpactPhase = "reviewing" | "waiting" | "approved" | "revised" | "rejected" | "cancelled";
export type ChangeApprovalImpact = {
  changeRequestId: string; approvalSnapshotId: string; revision: number;
  baselineScope: { id: string; version: string }; resultScope: { id: string; version: string } | null;
  currency: string; amount: { before: number | null; delta: number | null; after: number | null };
  duration: { beforeDays: number | null; deltaDays: number | null; afterDays: number | null; unit: "일" };
  completionDate: { before: string | null; after: string | null; status: "known" | "undetermined" | "review_required" };
  phase: ImpactPhase; canApprove: boolean; approvalBlockReason: string | null;
};
type Baseline = { id: string; majorVersion: number; minorVersion: number; document: unknown };
type Change = { id: string; baseScopeId: string; revision: number; request: string; review: unknown; amount: unknown; adjustmentReason: string | null; rates?: unknown };
const object = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const money = (value: unknown) => moneySchema.safeParse(value).success ? value as number : null;
const days = (value: unknown, min: number, max: number) => typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : null;
const dateOnly = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value ? value : null;

/** Only saved final values; missing values never become zero or today's date. */
export function buildChangeApprovalImpact(input: {
  change: Change; baseline: Baseline | null; snapshotId?: string; phase: ImpactPhase;
  datePolicy?: "CALENDAR_DAYS_UTC"; blockReason?: string | null;
  resultScope?: { id: string; version: string } | null;
  expectedAfter?: { amount?: unknown; durationDays?: unknown; deadline?: unknown };
}): ChangeApprovalImpact {
  const { change, baseline } = input;
  const doc = object(baseline?.document), estimate = object(doc.estimate), review = object(change.review);
  const before = money(estimate.total), delta = money(change.amount);
  const after = before === null || delta === null ? null : money(before + delta);
  const beforeDays = days(doc.durationDays, 1, 3650), deltaDays = days(review.scheduleImpactDays, 0, 365);
  const afterDays = beforeDays === null || deltaDays === null ? null : days(beforeDays + deltaDays, 1, 3650);
  const beforeDate = dateOnly(doc.deadline);
  let afterDate: string | null = null;
  let dateStatus: ChangeApprovalImpact["completionDate"]["status"] = "undetermined";
  if (doc.deadline != null && !beforeDate || beforeDate && (deltaDays === null || deltaDays !== 0 && !input.datePolicy)) dateStatus = "review_required";
  else if (beforeDate && deltaDays !== null) { afterDate = dateOnly(addDays(beforeDate, deltaDays)); dateStatus = afterDate ? "known" : "review_required"; }
  const currency = typeof (estimate.currency ?? doc.currency) === "string" ? String(estimate.currency ?? doc.currency) : "KRW";
  let reason = input.blockReason ?? null;
  if (!baseline || baseline.id !== change.baseScopeId) reason ??= "당시 비교 정보 확인 불가: 기준 승인 Scope를 찾을 수 없습니다.";
  if (currency !== "KRW" || review.currency != null && review.currency !== currency) reason ??= "금액의 통화 기준을 확인한 뒤 재검토해주세요.";
  if (before === null || delta === null || after === null) reason ??= "금액 기준 확인 필요: 담당자 재검토 후 승인 링크를 다시 요청해주세요.";
  if (deltaDays === null) reason ??= "기간 영향 확인 필요: 확정 추가 일수를 검토해주세요.";
  if (beforeDays !== null && deltaDays !== null && afterDays === null) reason ??= "변경 후 개발 기간이 허용 범위를 벗어났습니다.";
  if (dateStatus === "review_required") reason ??= "변경 후 완료일 계산 기준 확인이 필요합니다.";
  const expected = input.expectedAfter;
  if (expected && ("amount" in expected && expected.amount !== after || "durationDays" in expected && expected.durationDays !== afterDays || "deadline" in expected && (expected.deadline ?? null) !== afterDate)) reason ??= "변경 후 확정 데이터와 비교 정보가 다릅니다. 담당자 재검토가 필요합니다.";
  if (input.phase !== "waiting") reason ??= input.phase === "approved" ? "이미 승인된 변경 요청입니다." : "현재 고객 승인 대기 상태가 아닙니다.";
  return {
    changeRequestId: change.id, approvalSnapshotId: input.snapshotId ?? `draft:${change.id}:${change.revision}`, revision: change.revision,
    baselineScope: { id: change.baseScopeId, version: baseline ? `${baseline.majorVersion}.${baseline.minorVersion}` : "확인 불가" }, resultScope: input.resultScope ?? null,
    currency, amount: { before, delta, after }, duration: { beforeDays, deltaDays, afterDays, unit: "일" },
    completionDate: { before: beforeDate, after: afterDate, status: dateStatus }, phase: input.phase, canApprove: input.phase === "waiting" && !reason, approvalBlockReason: reason,
  };
}

export function publicChangeReview(value: unknown) {
  const parsed = comparisonSchema.safeParse(value);
  if (!parsed.success) return null;
  const r = parsed.data;
  return { classification: r.classification, reason: r.reason, scheduleImpactDays: r.scheduleImpactDays, removedExclusions: r.removedExclusions, newRequirements: r.newRequirements.map(({ title, description }) => ({ title, description })) };
}
export type ChangeApprovalSnapshot = {
  schemaVersion: 1; request: string; number: number; review: ReturnType<typeof publicChangeReview>;
  impact: ChangeApprovalImpact; targetFingerprint: string; baselineFingerprint: string;
};
export const changeTargetFingerprint = (change: Change) => fingerprint({ id: change.id, baseScopeId: change.baseScopeId, revision: change.revision, request: change.request, review: change.review, amount: change.amount, adjustmentReason: change.adjustmentReason, rates: change.rates });
const scopeIdentity = z.object({ id: z.string(), version: z.string() });
const snapshotSchema = z.object({
  schemaVersion: z.literal(1), request: z.string(), number: z.number().int(), targetFingerprint: z.string(), baselineFingerprint: z.string(),
  review: z.object({ classification: comparisonSchema.shape.classification, reason: z.string(), scheduleImpactDays: z.number().int(), removedExclusions: z.array(z.string()), newRequirements: z.array(z.object({ title: z.string(), description: z.string() })) }).nullable(),
  impact: z.object({ changeRequestId: z.string(), approvalSnapshotId: z.string(), revision: z.number().int().min(0), baselineScope: scopeIdentity, resultScope: scopeIdentity.nullable(), currency: z.string().regex(/^[A-Z]{3}$/), amount: z.object({ before: moneySchema.nullable(), delta: moneySchema.nullable(), after: moneySchema.nullable() }), duration: z.object({ beforeDays: z.number().int().nullable(), deltaDays: z.number().int().nullable(), afterDays: z.number().int().nullable(), unit: z.literal("일") }), completionDate: z.object({ before: z.string().date().nullable(), after: z.string().date().nullable(), status: z.enum(["known", "undetermined", "review_required"]) }), phase: z.enum(["reviewing", "waiting", "approved", "revised", "rejected", "cancelled"]), canApprove: z.boolean(), approvalBlockReason: z.string().nullable() }),
});
export function readChangeApprovalSnapshot(value: unknown): ChangeApprovalSnapshot | null {
  const parsed = snapshotSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
export const impactValuesFingerprint = (impact: ChangeApprovalImpact) => fingerprint({ baselineScope: impact.baselineScope, currency: impact.currency, amount: impact.amount, duration: impact.duration, completionDate: impact.completionDate });
export function impactPhase(status: string, decision?: string): ImpactPhase {
  if (decision === "REVISE") return "revised";
  if (decision === "REJECT" || status === "REJECTED") return "rejected";
  if (decision === "APPROVE" || status === "APPROVED") return "approved";
  return status === "CANCELLED" ? "cancelled" : status === "WAITING_CLIENT_APPROVAL" ? "waiting" : "reviewing";
}
