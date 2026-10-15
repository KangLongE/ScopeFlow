import { z } from "zod";

export const idSchema = z.string().uuid();
export const titleSchema = z.string().trim().min(1).max(160);
export const textSchema = z.string().trim().min(1).max(10_000);
export const moneySchema = z.number().int().min(0).max(1_000_000_000_000);
const hour = z.number().min(0).max(2000).refine(v => Math.abs(v * 100 - Math.round(v * 100)) < 1e-8, "시간은 소수 둘째 자리까지 입력해주세요.");
export const hoursSchema = z.object({ frontend: hour, backend: hour, design: hour, qa: hour });
export const ratesSchema = z.object({ frontend: moneySchema, backend: moneySchema, design: moneySchema, qa: moneySchema });
export const requirementInputSchema = z.object({
  category: titleSchema,
  title: titleSchema,
  description: textSchema,
  type: z.enum(["FEATURE", "NON_FUNCTIONAL", "DESIGN", "INFRA", "EXTERNAL_INTEGRATION"]),
  priority: z.enum(["HIGH", "MEDIUM", "LOW"]),
});
export const questionInputSchema = z.object({ question: textSchema, reason: z.string().trim().max(5000).default("") });
export const sourceRefsSchema = z.array(z.string().min(1).max(200)).max(80);
export const featureTypeSchema = z.enum(["PAYMENT", "SIGNUP", "ADMIN", "EXTERNAL_INTEGRATION", "OTHER"]);
export const implementationSchema = z.object({
  pageCount: z.number().int().min(1).max(1000).nullable(), separatePage: z.boolean().nullable(),
  serverWork: z.enum(["NONE", "STATIC_TOOLING", "SERVER_API", "UNKNOWN"]),
  featureTypes: z.array(featureTypeSchema).max(5),
  assets: z.array(z.object({ asset: z.enum(["LOGO", "MENU", "OTHER"]), work: z.enum(["APPLY", "ADJUST", "CREATE"]) })).max(10),
});
export const numericReferenceSchema = z.object({ fieldPath: z.string().min(1).max(200), value: z.number().finite(), text: textSchema });
const ruleFields = { numericReferences: z.array(numericReferenceSchema).max(40).optional() };
export const aiIssueSchema = z.object({ id: titleSchema, description: textSchema, sourceRefs: sourceRefsSchema, important: z.boolean() });
export const conditionSchema = z.object({ id: titleSchema, key: titleSchema, value: z.union([z.string().max(5000), z.number(), z.boolean()]), status: z.enum(["explicit", "pending"]), evidence: textSchema, sourceRefs: sourceRefsSchema, supersedes: z.array(titleSchema).max(30) });
export const exclusionSchema = z.object({ title: titleSchema, status: z.enum(["explicit", "pending"]), evidence: textSchema, sourceRefs: sourceRefsSchema });
export const reviewNotesSchema = z.object({ sourceRefs: sourceRefsSchema, constraints: z.array(conditionSchema).max(60), excludedScope: z.array(exclusionSchema).max(60), assumptions: z.array(aiIssueSchema).max(30), unresolvedItems: z.array(aiIssueSchema).max(30), proposedChanges: z.array(z.object({ type: z.enum(["ADD", "UPDATE", "REMOVE"]), requirementId: idSchema.nullable(), title: titleSchema, reason: textSchema, sourceRefs: sourceRefsSchema })).max(60) });
export const resolutionSchema = z.object({ id: titleSchema, reason: textSchema, sourceRefs: sourceRefsSchema });
export const aiRequirementSchema = requirementInputSchema.extend({ sourceRefs: sourceRefsSchema.default([]), existingRequirementId: idSchema.nullable().default(null), change: z.enum(["ADD", "UPDATE", "REMOVE", "KEEP"]).default("ADD"), implementation: implementationSchema.nullable().optional() });
const reviewFields = { reviewNotes: reviewNotesSchema.optional(), ...ruleFields };
export const initialAnalysisSchema = z.object({
  projectType: titleSchema,
  summary: textSchema,
  features: z.array(aiRequirementSchema.extend({ confidence: z.number().min(0).max(1) })).min(1).max(40),
  budget: z.object({ amount: moneySchema.nullable(), currency: z.literal("KRW") }),
  desiredDeadline: z.string().nullable(),
  missingInformation: z.array(questionInputSchema).max(8),
  ...reviewFields,
});
export const questionsResultSchema = z.object({ questions: z.array(questionInputSchema.extend({ sourceRefs: sourceRefsSchema.default([]), important: z.boolean().default(true) })).max(8), ...reviewFields });
export const requirementsResultSchema = z.object({ requirements: z.array(aiRequirementSchema).max(60), ...reviewFields });
export const estimateResultSchema = z.object({ items: z.array(z.object({ requirementId: idSchema, hours: hoursSchema, complexity: z.enum(["LOW", "MEDIUM", "HIGH"]), reason: textSchema, sourceRefs: sourceRefsSchema.default([]), implementation: implementationSchema.nullable().optional(), calculatedAmount: moneySchema.nullable().optional() })).min(1).max(60), ...reviewFields });
export const comparisonSchema = z.object({
  scopeDescription: textSchema.nullable().optional(),
  classification: z.enum(["IN_SCOPE", "PARTIALLY_IN_SCOPE", "OUT_OF_SCOPE", "UNCERTAIN"]),
  confidence: z.number().min(0).max(1),
  reason: textSchema,
  newRequirements: z.array(requirementInputSchema.extend({ sourceRefs: sourceRefsSchema.default([]), implementation: implementationSchema.nullable().optional() })).max(30),
  affectedExistingRequirements: z.array(idSchema).max(30),
  removedExclusions: z.array(textSchema).max(30),
  estimatedWork: hoursSchema,
  scheduleImpactDays: z.number().int().min(0).max(365),
  calculatedAmount: moneySchema.nullable().optional(),
  additionalCost: moneySchema.nullable().optional(),
  noCostReason: z.string().trim().max(5000).optional(), noScheduleReason: z.string().trim().max(5000).optional(),
  ...reviewFields,
});
export const scopeSummarySchema = z.object({ description: textSchema, excluded: z.array(textSchema).max(30), assumptions: z.array(textSchema).max(30), integrations: z.array(textSchema).max(30), deliverables: z.array(textSchema).min(1).max(30) });
export const scopeMetricsSchema = z.object({ total: moneySchema, durationDays: z.number().int().min(1).max(3650), items: z.array(z.object({ requirementId: z.string(), hours: hoursSchema })).max(100) });
export const scopeAIResultSchema = scopeSummarySchema.extend({ ...reviewFields, metrics: scopeMetricsSchema.nullable().optional() });

export type Hours = z.infer<typeof hoursSchema>;
export type Rates = z.infer<typeof ratesSchema>;
export const defaultRates: Rates = { frontend: 50_000, backend: 60_000, design: 45_000, qa: 40_000 };

export function calculateAmount(hours: Hours, rates: Rates) {
  hoursSchema.parse(hours);
  ratesSchema.parse(rates);
  return moneySchema.parse((Object.keys(hours) as (keyof Hours)[]).reduce((sum, role) => sum + Math.round(hours[role] * rates[role]), 0));
}

export const nextVersion = (latest: { majorVersion: number; minorVersion: number } | null) =>
  latest ? { majorVersion: latest.majorVersion, minorVersion: latest.minorVersion + 1 } : { majorVersion: 1, minorVersion: 0 };

export function addDays(date: string | null, days: number) {
  if (!date) return null;
  const value = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(value.valueOf()) || !Number.isInteger(days) || days < 0 || days > 3650) throw new Error("Invalid date calculation");
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
