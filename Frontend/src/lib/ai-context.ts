import { z } from "zod";
const refs = z.array(z.string());
export const issueSchema = z.object({ id: z.string(), description: z.string(), sourceRefs: refs, important: z.boolean() });
export const reviewNotesSchema = z.object({
  sourceRefs: refs,
  constraints: z.array(z.object({ id: z.string(), key: z.string(), value: z.union([z.string(), z.number(), z.boolean()]), status: z.enum(["explicit", "pending"]), evidence: z.string(), sourceRefs: refs, supersedes: z.array(z.string()) })),
  excludedScope: z.array(z.object({ title: z.string(), status: z.enum(["explicit", "pending"]), evidence: z.string(), sourceRefs: refs })),
  assumptions: z.array(issueSchema), unresolvedItems: z.array(issueSchema),
  proposedChanges: z.array(z.object({ type: z.enum(["ADD", "UPDATE", "REMOVE"]), requirementId: z.string().nullable(), title: z.string(), reason: z.string(), sourceRefs: refs })),
});
export type ContextIssue = z.infer<typeof issueSchema>;
export type Resolution = { id: string; reason: string; sourceRefs: string[] };
export type AIContextSnapshot = {
  scopeExclusions?: import("./scope-exclusions").ExclusionReview;
  inputFingerprint: string;
  sources: { id: string; label: string; text: string; revision: string; kind: string }[];
  savedAnswers: { question: string; answer: string }[];
  explicitCustomerConstraints: (z.infer<typeof reviewNotesSchema>["constraints"][number] & { active: boolean })[];
  confirmedIncludedScope: { title: string; description?: string; sourceRefs: string[] }[];
  confirmedExcludedScope: { title: string; sourceRefs: string[] }[];
  unresolvedItems: ContextIssue[];
  approvedBaseline: { id: string; version: string } | null;
  confirmedEstimate: { total: number; durationDays: number | null } | null;
  ownerDecisions?: { description: string; reason: string }[];
};
export type SavedAIContext = Partial<import("./rule-validation").ReviewState> & { execution?: import("./ai-usage").Execution; context: AIContextSnapshot; status: "READY" | "CHANGED" | "UNVERIFIED"; inputFingerprint: string; runId: string; issues?: ContextIssue[] };
