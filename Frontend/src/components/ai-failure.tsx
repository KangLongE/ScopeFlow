import type { MouseEventHandler } from "react";
import { aiFailureGuidance } from "@/lib/ai-failure";
import { creditStateLabel, type Execution } from "@/lib/ai-usage";

export function AIFailureNotice({ execution, manualHref, onManual, onRetry, retryCost, retryDisabled }: { execution: Execution; manualHref: string; onManual?: MouseEventHandler<HTMLAnchorElement>; onRetry?: () => void; retryCost?: number | null; retryDisabled?: boolean }) {
  const guidance = aiFailureGuidance(execution.errorCode, execution.error ?? "");
  return <section className="rule-validation" role="alert" aria-label="AI 실패 후 진행 방법"><strong>{guidance.title}</strong>{execution.error && <p>{execution.error}</p>}<p>{guidance.next}</p><p>실제 차감량 {execution.creditsUsed === null ? "확인 필요" : `${execution.creditsUsed} Credit`} · {creditStateLabel(execution.creditState)}</p><div className="actions-row"><a className="button secondary" href={manualHref} onClick={onManual}>수동 검토 계속하기</a>{guidance.canRetry && onRetry && <button type="button" className="button secondary" disabled={retryDisabled || retryCost == null} onClick={onRetry}>새 실행으로 재시도 · {retryCost == null ? "비용 확인 중" : `${retryCost} Credit 예상`}</button>}</div><p className="text-xs">수동 입력·서버 재검증은 AI를 재호출하지 않습니다. 새 AI 실행은 별도 비용 안내를 확인한 뒤 직접 선택할 때만 진행됩니다.</p></section>;
}
