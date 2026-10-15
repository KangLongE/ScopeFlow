export type ExclusionItem = {
  id: string; title: string; description: string | null;
  origin: "customer_request" | "customer_answer" | "staff" | "template" | "ai_assumption";
  sourceRefs: string[]; evidence: { sourceRef: string; revision: string; quote: string }[]; explicit: boolean;
  state: "pending" | "active" | "superseded" | "dismissed"; resolutionReason: string | null;
  resolutionSourceRefs: string[]; duplicateOf: string | null; reviewedBy: string | null; reviewedAt: string | null;
  resolutionEvidence?: { sourceRef: string; revision: string; quote: string }[];
  extractionRunIds?: string[];
};
export type ExclusionReview = { revision: number; contextFingerprint: string; items: ExclusionItem[] };
export const exclusionOrigin = { customer_request: "고객 원문", customer_answer: "저장된 고객 답변", staff: "담당자 조건 · 과거 자유 문구 포함", template: "공통 템플릿", ai_assumption: "AI 제안 · 확인 필요" };
export const exclusionState = { pending: "검토 필요", active: "담당자 확인 · 고객 승인 전", superseded: "후속 조건으로 해제", dismissed: "채택하지 않은 후보" };
export function scopeExclusionRows(document: { excluded: string[]; exclusions?: { title: string; description: string | null }[] }) {
  return document.exclusions ?? document.excluded.map(title => ({ title, description: null }));
}
