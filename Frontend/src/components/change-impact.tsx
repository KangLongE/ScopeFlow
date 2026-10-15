import { impactAmountDelta, impactDays, impactDayDelta, impactMoney, impactSentence, type ChangeApprovalImpact } from "@/lib/change-approval-impact";

export function ChangeImpactSummary({ impact, number, pending = false }: { impact?: ChangeApprovalImpact | null; number?: number; pending?: boolean }) {
  if (pending) return <section className="change-impact" aria-busy="true" aria-label="금액·기간 변화"><h3>금액·기간 변화</h3><p role="status">수정 내용의 금액·기간 요약은 서버 저장·재검증 후 갱신됩니다.</p></section>;
  if (!impact) return <section className="change-impact"><h3>금액·기간 변화</h3><p role="status">당시 비교 정보 확인 불가. 담당자에게 승인 기준 확인을 요청해주세요.</p></section>;
  const approved = impact.phase === "approved";
  const resultLabel = approved ? "승인된 값" : impact.phase === "reviewing" ? "변경 후 예상" : impact.phase === "waiting" && impact.canApprove ? "변경 승인 시" : "당시 비교값";
  const rows = [
    { title: "총 견적", before: impactMoney(impact.amount.before, impact.currency), delta: impactAmountDelta(impact.amount.delta, impact.currency), after: impactMoney(impact.amount.after, impact.currency) },
    { title: "예상 개발 기간", before: impactDays(impact.duration.beforeDays, impact.duration.unit), delta: impactDayDelta(impact.duration.deltaDays, impact.duration.unit), after: impactDays(impact.duration.afterDays, impact.duration.unit) },
  ];
  return <section className="change-impact" aria-label="금액·기간 변화">
    <div className="row"><h3>금액·기간 변화</h3><span className="text-xs">{approved ? "승인 완료" : impact.phase === "reviewing" ? "검토 중 예상" : impact.phase === "waiting" ? "승인 대기" : "처리된 요청"}</span></div>
    <p className="text-xs">기준: Scope v{impact.baselineScope.version}{number !== undefined ? ` · 변경 요청 #${number}` : ""}{impact.resultScope ? ` → 승인된 Scope v${impact.resultScope.version}` : ""}</p>
    {rows.map(row => <section key={row.title} className="impact-row" aria-label={`${row.title} 비교`}><h4>{row.title}</h4><dl>{[{ label: "기존", value: row.before }, { label: "이번 변경", value: row.delta }, { label: resultLabel, value: row.after }].map((cell, i) => <div key={cell.label} className={i === 2 ? "impact-result" : ""}><dt>{cell.label} {row.title}</dt><dd>{cell.value}</dd></div>)}</dl></section>)}
    {impact.completionDate.status === "undetermined" ? <p>예상 완료일: 미정</p> : <dl className="impact-dates"><div><dt>기존 예상 완료일</dt><dd>{impact.completionDate.before ?? "미정"}</dd></div><div><dt>{approved ? "승인된" : "변경 승인 시"} 예상 완료일</dt><dd>{impact.completionDate.status === "review_required" ? "확인 필요" : impact.completionDate.after ?? "미정"}</dd></div></dl>}
    <p className="impact-sentence">{impactSentence(impact)}</p>
    <p className="text-xs">총 견적은 프로젝트 범위의 전체 견적이며, 미납액이나 지금 결제할 금액이 아닙니다.{approved && " 당시 승인 기준입니다. 이후 변경의 현재 총액과 구분해주세요."}</p>
    {impact.approvalBlockReason && impact.phase !== "approved" && impact.approvalBlockReason !== "현재 고객 승인 대기 상태가 아닙니다." && <p className="form-error" role="alert">{impact.approvalBlockReason}</p>}
  </section>;
}
