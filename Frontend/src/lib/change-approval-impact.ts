export type ChangeApprovalImpact = {
  changeRequestId: string; approvalSnapshotId: string; revision: number;
  baselineScope: { id: string; version: string }; resultScope: { id: string; version: string } | null;
  currency: string; amount: { before: number | null; delta: number | null; after: number | null };
  duration: { beforeDays: number | null; deltaDays: number | null; afterDays: number | null; unit: string };
  completionDate: { before: string | null; after: string | null; status: "known" | "undetermined" | "review_required" };
  phase: "reviewing" | "waiting" | "approved" | "revised" | "rejected" | "cancelled";
  canApprove: boolean; approvalBlockReason: string | null;
};
export function impactMoney(value: number | null, currency = "KRW") {
  if (value === null) return "확인 필요";
  return currency === "KRW" ? `${value.toLocaleString("ko-KR")}원` : new Intl.NumberFormat("ko-KR", { style: "currency", currency }).format(value);
}
export function impactAmountDelta(value: number | null, currency = "KRW") {
  return value === null ? "확인 필요" : value === 0 ? `${impactMoney(0, currency)} · 금액 변화 없음` : `${value > 0 ? "+" : ""}${impactMoney(value, currency)}`;
}
export const impactDays = (value: number | null, unit: string) => value === null ? "미정" : `${value.toLocaleString("ko-KR")}${unit}`;
export const impactDayDelta = (value: number | null, unit: string) => value === null ? "기간 영향 확인 필요" : `${value >= 0 ? "+" : ""}${impactDays(value, unit)}${value === 0 ? " · 기간 변화 없음" : ""}`;
export function impactSentence(impact: ChangeApprovalImpact) {
  if (impact.phase === "waiting" && impact.canApprove === false) return "발급 당시 비교 정보입니다. 승인 기준을 재검토한 뒤 새 링크를 요청해주세요.";
  if (["revised", "rejected", "cancelled"].includes(impact.phase)) return "당시 비교 정보입니다. 이 요청은 현재 승인할 수 없습니다.";
  const lead = impact.phase === "approved" ? "승인된 프로젝트" : impact.phase === "reviewing" ? "검토 중 예상" : "이번 변경을 승인하면 프로젝트";
  return `${lead} 총 견적은 ${impactMoney(impact.amount.after, impact.currency)}, 예상 개발 기간은 ${impactDays(impact.duration.afterDays, impact.duration.unit)}입니다.`;
}
