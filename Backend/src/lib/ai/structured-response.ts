import type { ZodType } from "zod";

// Lossless repair of one observed provider defect. Never fill missing facts, choose conflicting values, or coerce types.
export function recoverReviewNotes<T>(value: unknown, schema: ZodType<T>, rootFields: string[], exclusionAliases: Map<string, string> = new Map()): T | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || !rootFields.includes("reviewNotes")) return null;
  const root = structuredClone(value) as Record<string, unknown>;
  const notes = root.reviewNotes;
  if (!notes || typeof notes !== "object" || Array.isArray(notes)) return null;
  let moved = false;
  if (Array.isArray(root.removedExclusions)) root.removedExclusions = root.removedExclusions.map(title => { const resolved = exclusionAliases.get(title); if (resolved && resolved !== title) moved = true; return resolved ?? title; });
  for (const key of ["sourceRefs", "constraints", "excludedScope", "assumptions", "unresolvedItems", "proposedChanges"]) {
    if (!(key in root) || rootFields.includes(key)) continue;
    if (key in notes) return null;
    (notes as Record<string, unknown>)[key] = root[key]; delete root[key]; moved = true;
  }
  if (!moved || Object.keys(root).some(key => !rootFields.includes(key))) return null;
  const parsed = schema.safeParse(root);
  return parsed.success ? parsed.data : null;
}
