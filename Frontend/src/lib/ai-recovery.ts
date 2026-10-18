import { z } from "zod";
import { initialSchema, type workSchema } from "./model";

// Editor-only: empty features remain invalid at the server until a human adds grounded work.
export const initialEditorSchema = initialSchema.extend({ features: z.array(initialSchema.shape.features.element).max(40) });
export function linkEstimateRequirement(item: z.infer<typeof workSchema>["items"][number], requirementId: string) {
  return { ...item, requirementId, sourceRefs: [...new Set([...item.sourceRefs.filter(ref => !ref.startsWith("requirement:")), `requirement:${requirementId}`])] };
}
