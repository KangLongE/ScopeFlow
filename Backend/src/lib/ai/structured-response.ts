import type { ZodType } from "zod";

export const reviewNoteFields = ["sourceRefs", "constraints", "excludedScope", "assumptions", "unresolvedItems", "proposedChanges"] as const;

// Lossless repair of one observed provider defect. Never fill missing facts, choose conflicting values, or coerce types.
export function recoverReviewNotes<T>(value: unknown, schema: ZodType<T>, rootFields: string[], exclusionAliases: Map<string, string> = new Map()): T | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || !rootFields.includes("reviewNotes")) return null;
  const root = structuredClone(value) as Record<string, unknown>;
  const notes = root.reviewNotes;
  if (!notes || typeof notes !== "object" || Array.isArray(notes)) return null;
  let moved = false;
  if (Array.isArray(root.removedExclusions)) root.removedExclusions = root.removedExclusions.map(title => { const resolved = exclusionAliases.get(title); if (resolved && resolved !== title) moved = true; return resolved ?? title; });
  for (const key of reviewNoteFields) {
    if (!(key in root) || rootFields.includes(key)) continue;
    if (key in notes) return null;
    (notes as Record<string, unknown>)[key] = root[key]; delete root[key]; moved = true;
  }
  if (!moved || Object.keys(root).some(key => !rootFields.includes(key))) return null;
  const parsed = schema.safeParse(root);
  return parsed.success ? parsed.data : null;
}

// Missing lists mean an incomplete review, never an assertion that no conditions or questions exist.
export function comparisonReviewNotes<T>(value: unknown, schema: ZodType<T>, rootFields: string[], exclusionAliases: Map<string, string> = new Map()): { data: T; missingFields: string[] } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const root = structuredClone(value) as Record<string, unknown>;
  if (root.reviewNotes !== undefined && (!root.reviewNotes || typeof root.reviewNotes !== "object" || Array.isArray(root.reviewNotes))) return null;
  const notes = (root.reviewNotes ?? {}) as Record<string, unknown>;
  for (const key of reviewNoteFields) {
    if (!(key in root) || rootFields.includes(key)) continue;
    if (key in notes) return null;
    notes[key] = root[key]; delete root[key];
  }
  if (Object.keys(root).some(key => !rootFields.includes(key))) return null;
  const missingFields = reviewNoteFields.filter(key => !(key in notes));
  for (const key of missingFields) notes[key] = [];
  if (missingFields.length) {
    if (!Array.isArray(notes.unresolvedItems)) return null;
    const labels = { sourceRefs: "판정 근거", constraints: "고객 조건", excludedScope: "제외 범위", assumptions: "가정", unresolvedItems: "미확정 사항", proposedChanges: "변경 제안" };
    let id = "provider:missing-review-fields";
    while (notes.unresolvedItems.some(issue => issue?.id === id)) id += ":missing";
    notes.unresolvedItems.push({ id, description: `AI 응답에서 ${missingFields.map(key => labels[key]).join("·")} 항목이 누락되었습니다. 원문·승인 Scope·변경 요청을 대조해 빠진 조건과 질문·제안을 확인해주세요. 빈 목록은 해당 사항이 없다는 확정이 아닙니다.`, sourceRefs: [], important: true });
  }
  root.reviewNotes = notes;
  if (Array.isArray(root.removedExclusions)) root.removedExclusions = root.removedExclusions.map(title => exclusionAliases.get(title) ?? title);
  const parsed = schema.safeParse(root);
  return parsed.success ? { data: parsed.data, missingFields } : null;
}
