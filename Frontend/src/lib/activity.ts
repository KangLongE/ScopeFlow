export type Activity = { id: string; event: string; createdAt: string; display?: { project: { id: string; name: string } | null; actorName: string | null; scopeVersion: string | null; changeNumber: number | null; requirementName: string | null; task: string | null; requirementCount: number | null; href: string | null } };
export function activityText(log: Activity) {
  const display = log.display;
  const prefix = display?.project ? "‘" + display.project.name + "’ " : "";
  const scope = display?.scopeVersion ? "Scope v" + display.scopeVersion : "Scope";
  const change = display?.changeNumber !== null && display?.changeNumber !== undefined ? "변경 요청 #" + display.changeNumber : "변경 요청";
  const names: Record<string, string> = { PROJECT_CREATED: "프로젝트 생성", PROJECT_STATUS_CHANGED: "프로젝트 상태 변경", REQUIREMENT_CREATED: "요구사항 추가", REQUIREMENT_UPDATED: "요구사항 수정", REQUEST_SAVED: "고객 요청 저장", ANSWER_SAVED: "고객 답변 저장", SCOPE_CREATED: scope + " 초안 생성", SCOPE_EXCLUSIONS_REVIEWED: scope + " 제외 조건 검토", SCOPE_AI_REVIEWED: scope + " 초안 검토", SCOPE_APPROVAL_REQUESTED: scope + " 승인 요청", CHANGE_APPROVAL_REQUESTED: change + " 승인 요청", SCOPE_APPROVED: scope + " 승인", CHANGE_REQUEST_CREATED: change + " 생성", CHANGE_REQUEST_EDITED: change + " 원문 수정", CHANGE_REQUEST_APPROVED: change + " 승인" + (display?.scopeVersion ? " · " + scope + " 생성" : ""), CLIENT_APPROVE: (display?.changeNumber != null ? change : scope) + " 승인 의견 기록", CLIENT_REVISE: (display?.changeNumber != null ? change : scope) + " 수정 요청", CLIENT_REJECT: change + " 거절" };
  if (log.event === "AI_DRAFT_APPLIED") names.AI_DRAFT_APPLIED = display?.task === "requirements" ? "요구사항" + (display.requirementCount !== null ? " " + display.requirementCount + "개" : "") + " 반영" : "검토한 AI 초안 반영";
  if (!names[log.event]) return prefix + "활동 기록 · 상세 정보 확인 불가";
  return prefix + names[log.event] + (display?.requirementName ? " · " + display.requirementName : "");
}
