import type { ZodType } from "zod";
import { reviewNotesSchema } from "@/lib/model";
import type { ProjectAIContext } from "@/lib/services/ai-context.service";

export const reviewNoteFields = ["sourceRefs", "constraints", "excludedScope", "assumptions", "unresolvedItems", "proposedChanges"] as const;

// Existing approved exclusions have an authoritative quote; do not ask the model to recreate it.
export function linkApprovedExclusionEvidence<T>(value: T, input: unknown): T {
  const context = input as Partial<Pick<ProjectAIContext, "operation" | "approvedBaseline" | "sources">> | null;
  const baseline = context?.approvedBaseline, sources = context?.sources;
  if (context?.operation !== "SCOPE_COMPARISON" || !baseline?.isCurrent || !sources || !value || typeof value !== "object") return value;
  const candidate = value as { reviewNotes?: unknown; removedExclusions?: string[] };
  const parsed = reviewNotesSchema.safeParse(candidate.reviewNotes);
  if (!parsed.success) return value;
  const approved = (baseline.document as { excluded?: string[] }).excluded ?? [];
  const prefix = `scope-excluded:${baseline.id}:`;
  let linked = false;
  const excludedScope = parsed.data.excludedScope.map(row => {
    if (row.status !== "explicit" || !approved.includes(row.title) || Array.isArray(candidate.removedExclusions) && candidate.removedExclusions.includes(row.title) || !row.sourceRefs.length || row.sourceRefs.some(id => !id.startsWith(prefix) || !sources.some(s => s.id === id))) return row;
    const matches = sources.filter(s => s.kind === "APPROVED_SCOPE" && s.id.startsWith(prefix) && s.revision === baseline.version && s.text === row.title);
    if (matches.length !== 1) return row;
    if (row.evidence === matches[0].text && row.sourceRefs.length === 1 && row.sourceRefs[0] === matches[0].id) return row;
    linked = true;
    return { ...row, evidence: matches[0].text, sourceRefs: [matches[0].id] };
  });
  return linked ? { ...value, reviewNotes: { ...(candidate.reviewNotes as object), excludedScope } } : value;
}

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
