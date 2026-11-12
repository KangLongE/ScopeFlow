import { z } from "zod";
import { initialSchema, type workSchema } from "./model";
import type { AIContextSnapshot } from "./ai-context";

export function approvedExclusionSource(title: string, context?: AIContextSnapshot) {
  const baseline = context?.approvedBaseline;
  if (!baseline) return undefined;
  const matches = context.sources.filter(s => s.kind === "APPROVED_SCOPE" && s.id.startsWith(`scope-excluded:${baseline.id}:`) && s.revision === baseline.version && s.text === title);
  return matches.length === 1 ? matches[0] : undefined;
}

// Editor-only: empty features remain invalid at the server until a human adds grounded work.
export const initialEditorSchema = initialSchema.extend({ features: z.array(initialSchema.shape.features.element).max(40) });
export function linkEstimateRequirement(item: z.infer<typeof workSchema>["items"][number], requirementId: string) {
  return { ...item, requirementId, sourceRefs: [...new Set([...item.sourceRefs.filter(ref => !ref.startsWith("requirement:")), `requirement:${requirementId}`])] };
}
