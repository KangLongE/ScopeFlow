import { calculateAmount, labels } from "./model";
import type { ProjectDetail } from "./queries";

export const scopeVersion = (scope: { majorVersion: number; minorVersion: number }) => `v${scope.majorVersion}.${scope.minorVersion}`;
export function estimateTotal(project: Pick<ProjectDetail, "estimate" | "scopes">) {
  const approved = project.scopes.find(s => s.status === "APPROVED");
  if (approved) return approved.document.estimate.total;
  const estimate = project.estimate;
  return estimate ? estimate.overrideTotal ?? estimate.items.reduce((sum, item) => sum + calculateAmount(item.hours, estimate.rates), 0) : null;
}
export function projectStep(project: ProjectDetail) {
  const root = `/projects/${project.id}`;
  const step = (title: string, description: string, action: string, path: string) => ({ title, description, action, href: root + path });
  if (["COMPLETED", "CANCELLED"].includes(project.status)) return step(labels[project.status], "보관된 범위와 변경 이력을 확인할 수 있습니다.", "Scope 이력 보기", "/scope");
  if (project.status === "WAITING_SCOPE_APPROVAL") return step("Scope 승인 대기", "고객이 범위·견적·일정을 검토하고 있습니다.", "승인 상태 확인", "/scope");
  if (project.status === "WAITING_CHANGE_APPROVAL") return step("변경 승인 대기", "고객 승인 후 새 Scope 버전이 생성됩니다.", "변경 승인 확인", "/changes");
  const pendingChange = project.changeRequests?.find(change => ["DRAFT", "WAITING_INTERNAL_REVIEW"].includes(change.status));
  if (pendingChange) return step("변경 요청 검토", "추가 요청을 기존 Scope와 비교하고 변경 견적을 확인하세요.", "변경 요청 검토", `/changes#${pendingChange.id}`);
  if (project.scopes.some(s => s.status === "APPROVED")) return step("합의한 범위로 진행 중", "추가 요청은 기존 Scope와 비교하고 별도로 승인받으세요.", "새 변경 요청", "/changes#new");
  if (Object.values(project.aiDrafts ?? {}).some(d => d?.revision === project.revision)) return step("AI 결과 검토", "초안은 아직 확정 데이터에 반영되지 않았습니다.", "분석 결과 검토", project.aiDrafts.estimate?.revision === project.revision ? "/estimate" : "/requirements");
  if (project.questions.some(q => !q.answer)) return step("고객 답변 대기", "답변을 확인한 뒤 요구사항을 확정하세요.", "질문·답변 확인", "/requirements#questions");
  if (!project.requirements.some(r => r.status === "CONFIRMED") || project.requirements.some(r => r.status === "PENDING")) return step("요구사항 정리 중", "고객 요청을 분석하고 확인 필요 항목을 정리하세요.", "요구사항 정리", "/requirements");
  if (!project.estimate || project.requirements.filter(r => r.status === "CONFIRMED").some(r => !project.estimate?.items.some(i => i.requirementId === r.id && i.reviewed))) return step("견적 검토", "확정된 기능의 작업량과 금액을 검토하세요.", "견적 만들기", "/estimate");
  return step("Scope 초안 준비", "포함·제외 범위와 기간을 확인해 고객에게 승인받으세요.", "Scope 확인·승인 요청", "/scope");
}
