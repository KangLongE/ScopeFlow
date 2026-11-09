"use client";
import { creditStateLabel, type Execution } from "@/lib/ai-usage";
import { useCredit } from "./credit";
export function AIExecutionSummary({ execution }: { execution?: Execution }) {
  const credit = useCredit();
  if (!execution) return null;
  const incomplete = execution.errorCode === "AI_RESPONSE_INCOMPLETE";
  return <div className="notice" role="status"><span>{incomplete ? "AI 미완성 검토 초안 보존됨" : "AI 실행 완료"} · {creditStateLabel(execution.creditState)} · 실제 사용 {execution.creditsUsed === null ? "확인 중" : execution.creditsUsed + " Credit"}{credit.data && !credit.error && !credit.loading ? " · 현재 잔여 " + credit.data.availableCredits + " Credit" : " · 현재 잔여 확인 중"}<br />{incomplete ? "누락된 검토 항목과 범위 판정을 원문·승인 Scope에 맞춰 확인해주세요. " : "실행 완료와 초안 검증 결과는 별개입니다. "}수정·서버 재검증에는 추가 Credit이 들지 않습니다.</span></div>;
}
