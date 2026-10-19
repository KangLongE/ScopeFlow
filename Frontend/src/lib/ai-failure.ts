import type { AITask } from "./ai-usage";

export function aiFailureGuidance(code?: string | null, message = "") {
  if (code === "AI_PROVIDER_BAD_REQUEST" || code === "AI_PROVIDER_ERROR" && /\(400\)/.test(message)) return { title: "AI 요청 형식 확인 필요", next: "모델·응답 스키마 설정을 확인해야 합니다. 같은 요청을 반복하기보다 수동 검토를 계속해주세요.", canRetry: false };
  if (["AI_PROVIDER_AUTH_ERROR", "AI_PROVIDER_MODEL_UNAVAILABLE"].includes(code ?? "")) return { title: "AI 연결 설정 확인 필요", next: "관리자가 키·모델 접근 권한·요청 경로를 확인한 뒤 다시 실행해주세요. 그동안 수동 검토는 가능합니다.", canRetry: false };
  if (code === "AI_CONTEXT_TOO_LARGE") return { title: "AI 입력·토큰 한도 확인 필요", next: "고객 조건을 임의로 삭제하지 말고 응답 상한·계정 한도를 확인해주세요. 수동 검토로 계속 진행할 수 있습니다.", canRetry: false };
  if (code === "AI_PROVIDER_RATE_LIMITED") return { title: "AI 제공자 한도 도달", next: "표시된 한도를 확인하고 여유가 생긴 뒤 직접 재시도해주세요. 자동 유료 재호출은 하지 않습니다.", canRetry: true };
  if (code === "AI_INVALID_RESPONSE") return { title: "AI 응답 형식 생성 실패", next: "기존 원문과 저장된 검토는 보존됩니다. 직접 입력으로 계속하거나 새 실행 비용을 확인한 뒤 재시도할 수 있습니다.", canRetry: true };
  return { title: "AI 실행 실패", next: "실행 기록을 확인하고 일시적 문제라면 잠시 후 직접 재시도해주세요. 수동 검토도 계속할 수 있습니다.", canRetry: true };
}
export function manualReviewLink(projectId: string, task: AITask, changeId?: string) {
  const target = task === "compare" ? `manual-change-${changeId ?? "new"}` : task === "estimate" ? "manual-estimate" : task === "summary" ? "scope-editor" : "manual-requirements";
  const page = task === "compare" ? "changes" : task === "estimate" ? "estimate" : task === "summary" ? "scope" : "requirements";
  return { target, href: `/projects/${encodeURIComponent(projectId)}/${page}#${encodeURIComponent(target)}` };
}
