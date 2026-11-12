import { won, type ScopeDocument } from "@/lib/model";

export function EstimateTotals({ estimate, finalLabel = "최종 견적" }: { estimate: Pick<ScopeDocument["estimate"], "items" | "total"> & { adjustmentReason?: string | null }; finalLabel?: string }) {
  const subtotal = estimate.items.reduce((sum, item) => sum + item.amount, 0);
  const adjustment = estimate.total - subtotal;
  const reason = estimate.adjustmentReason?.trim();
  return <section className="estimate-breakdown" aria-label="견적 금액 구성">
    <dl>
      <div><dt>항목 합계</dt><dd>{won(subtotal)}</dd></div>
      <div><dt>조정액</dt><dd>{adjustment < 0 ? "−" : adjustment > 0 ? "+" : ""}{won(Math.abs(adjustment))}</dd></div>
      <div className="estimate-final"><dt>{finalLabel}</dt><dd>{won(estimate.total)}</dd></div>
    </dl>
    {(adjustment !== 0 || reason) && <div className="estimate-adjustment-reason"><h3>조정 사유</h3><p className="prose">{reason || "조정 사유가 기록되어 있지 않습니다."}</p></div>}
  </section>;
}
