import type { ZodError } from "zod";
export function inputFieldErrors(issues: ZodError["issues"], action?: string) {
  const labels: Record<string, string> = { name: action?.startsWith("project.") ? "프로젝트 이름" : "이름", content: "요청 내용", message: "수정 요청 사유", adjustmentReason: "견적 조정 사유", email: "이메일", title: "기능 이름", category: "분류", description: "설명", clientId: "고객", request: "변경 요청", budget: "예산", overrideTotal: "최종 견적", overrideAmount: "변경 금액", reason: "산정 근거", durationDays: "예상 기간", creditLimit: "Workspace 월 한도", userCreditLimit: "사용자 월 한도", consent: "검토 동의", frontend: "Frontend 작업량", backend: "Backend 작업량", design: "Design 작업량", qa: "QA 작업량" };
  return issues.map(issue => {
    const fieldPath = issue.path.map(String).join(".");
    const field = String(issue.path.at(-1) ?? "입력");
    const label = labels[field] ?? "해당 항목";
    const last = label.charCodeAt(label.length - 1); const final = last >= 0xac00 && last <= 0xd7a3 && (last - 0xac00) % 28 !== 0;
    const object = label + (final ? "을" : "를"); const subject = label + (final ? "은" : "는");
    let message = object + " 확인해주세요.";
    if (issue.code === "too_small") message = issue.origin === "string" && issue.minimum === 1 ? object + " 입력해주세요." : subject + " " + issue.minimum + " 이상이어야 합니다.";
    if (issue.code === "too_big") message = subject + " " + issue.maximum + " 이하여야 합니다.";
    if (issue.code === "invalid_type") message = issue.expected === "number" ? label + "에 올바른 숫자를 입력해주세요." : object + " 입력해주세요.";
    if (issue.code === "invalid_format") message = field === "email" ? "올바른 이메일 주소를 입력해주세요." : label + "의 형식을 확인해주세요.";
    if (issue.code === "custom" && /[가-힣]/.test(issue.message)) message = issue.message;
    if (field === "name" && action?.startsWith("project.") && issue.code === "too_small") message = "프로젝트 이름을 입력해주세요.";
    return { fieldPath, message };
  });
}
