import { z } from "zod";

export const idSchema = z.string().uuid();
export const titleSchema = z.string().trim().min(1).max(160);
export const textSchema = z.string().trim().min(1).max(10_000);
export const moneySchema = z.number().int().min(0).max(1_000_000_000_000);
export const hoursSchema = z.object({ frontend: z.number().min(0).max(2000), backend: z.number().min(0).max(2000), design: z.number().min(0).max(2000), qa: z.number().min(0).max(2000) });
export const ratesSchema = z.object({ frontend: moneySchema, backend: moneySchema, design: moneySchema, qa: moneySchema });
export const requirementInputSchema = z.object({
  category: titleSchema,
  title: titleSchema,
  description: textSchema,
  type: z.enum(["FEATURE", "NON_FUNCTIONAL", "DESIGN", "INFRA", "EXTERNAL_INTEGRATION"]),
  priority: z.enum(["HIGH", "MEDIUM", "LOW"]),
});
export const questionInputSchema = z.object({ question: textSchema, reason: z.string().trim().max(5000).default("") });
export const initialAnalysisSchema = z.object({
  projectType: titleSchema,
  summary: textSchema,
  features: z.array(requirementInputSchema.extend({ confidence: z.number().min(0).max(1) })).min(1).max(40),
  budget: z.object({ amount: moneySchema.nullable(), currency: z.literal("KRW") }),
  desiredDeadline: z.string().nullable(),
  missingInformation: z.array(questionInputSchema).max(8),
});
export const questionsResultSchema = z.object({ questions: z.array(questionInputSchema).min(1).max(8) });
export const requirementsResultSchema = z.object({ requirements: z.array(requirementInputSchema).min(1).max(60) });
export const estimateResultSchema = z.object({ items: z.array(z.object({ requirementId: idSchema, hours: hoursSchema, complexity: z.enum(["LOW", "MEDIUM", "HIGH"]), reason: textSchema })).min(1).max(60) });
export const comparisonSchema = z.object({
  classification: z.enum(["IN_SCOPE", "PARTIALLY_IN_SCOPE", "OUT_OF_SCOPE", "UNCERTAIN"]),
  confidence: z.number().min(0).max(1),
  reason: textSchema,
  newRequirements: z.array(requirementInputSchema).max(30),
  affectedExistingRequirements: z.array(idSchema).max(30),
  removedExclusions: z.array(textSchema).max(30),
  estimatedWork: hoursSchema,
  scheduleImpactDays: z.number().int().min(0).max(365),
});
export const scopeSummarySchema = z.object({ description: textSchema, excluded: z.array(textSchema).max(30), assumptions: z.array(textSchema).max(30), integrations: z.array(textSchema).max(30), deliverables: z.array(textSchema).min(1).max(30) });

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

