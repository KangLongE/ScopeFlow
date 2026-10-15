"use client";
import { creditStateLabel, type Execution } from "@/lib/ai-usage";
import { useCredit } from "./credit";
export function AIExecutionSummary({ execution }: { execution?: Execution }) {
  const credit = useCredit();
  if (!execution) return null;
  return <div className="notice" role="status"><span>AI 실행 완료 · {creditStateLabel(execution.creditState)} · 실제 사용 {execution.creditsUsed === null ? "확인 중" : execution.creditsUsed + " Credit"}{credit.data && !credit.error && !credit.loading ? " · 현재 잔여 " + credit.data.availableCredits + " Credit" : " · 현재 잔여 확인 중"}<br />실행 완료와 초안 검증 결과는 별개입니다. 수정·서버 재검증에는 추가 Credit이 들지 않습니다.</span></div>;
}
