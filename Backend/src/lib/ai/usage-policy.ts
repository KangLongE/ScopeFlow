import { createHash } from "node:crypto";
import { z } from "zod";
import type { AIAction } from "@/generated/prisma/client";

export const credits: Record<AIAction, number> = { INITIAL_ANALYSIS: 2, QUESTIONS: 1, REQUIREMENTS: 2, ESTIMATE: 2, SCOPE_SUMMARY: 1, SCOPE_COMPARISON: 3 };
export const creditCost = (action: AIAction) => credits[action];
export const policyRevision = () => createHash("sha256").update(JSON.stringify(credits)).digest("hex");
export const aiExecutionSchema = z.object({ executionKey: z.string().uuid(), policyRevision: z.string().min(1).max(128) });
export type AIExecutionOptions = Partial<z.infer<typeof aiExecutionSchema>> & { requestFingerprint?: string };
export function executionFingerprint(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export function creditPreview(action: AIAction, workspace: { used: number; reserved: number; limit: number }, user: { used: number; reserved: number; limit: number }, cached = false) {
  const availableCredits = Math.max(0, Math.min(workspace.limit - workspace.used - workspace.reserved, user.limit - user.used - user.reserved));
  const cost = cached ? 0 : creditCost(action);
  return { operation: action, policyRevision: policyRevision() + (cached ? ":cached" : ""), creditCost: cost, availableCredits, expectedRemaining: availableCredits >= cost ? availableCredits - cost : null, canExecute: availableCredits >= cost, blockReason: availableCredits < cost ? `이 작업에는 ${cost} Credit이 필요합니다. 현재 잔여량은 ${availableCredits} Credit입니다.` : null };
}

export type CostStatus = "estimated" | "unconfigured" | "usage_missing" | "unknown";
export type ApiCost = { status: CostStatus; estimatedUsd: number | null };
export function modelPrice(settings: string, model: string) {
  try { return z.record(z.string(), z.object({ input: z.number().finite().min(0), output: z.number().finite().min(0) })).parse(JSON.parse(settings))[model] ?? null; }
  catch { return null; }
}
export function apiCost(price: { input: number; output: number } | null, usage: { inputTokens: number; outputTokens: number; usageKnown?: boolean }, cached = false): ApiCost {
  if (cached) return { status: "estimated", estimatedUsd: 0 };
  if (!price) return { status: "unconfigured", estimatedUsd: null };
  if (usage.usageKnown === false || ![usage.inputTokens, usage.outputTokens].every(v => Number.isSafeInteger(v) && v >= 0)) return { status: "usage_missing", estimatedUsd: null };
  const cost = (usage.inputTokens * price.input + usage.outputTokens * price.output) / 1_000_000;
  return Number.isFinite(cost) ? { status: "estimated", estimatedUsd: cost } : { status: "unknown", estimatedUsd: null };
}
export function historicalCost(item: { costStatus?: string | null; estimatedCost: number }): ApiCost {
  const status = item.costStatus as CostStatus | undefined;
  if (status === "estimated") return { status, estimatedUsd: item.estimatedCost };
  if (status && ["unconfigured", "usage_missing", "unknown"].includes(status)) return { status, estimatedUsd: null };
  return item.estimatedCost > 0 ? { status: "estimated", estimatedUsd: item.estimatedCost } : { status: "unknown", estimatedUsd: null };
}
export function costSummary(items: { apiCost: ApiCost }[]) {
  const calculated = items.filter(item => item.apiCost.status === "estimated" && item.apiCost.estimatedUsd !== null);
  return { status: !items.length ? "empty" : calculated.length === items.length ? "estimated" : calculated.length ? "partial" : "unknown", subtotalUsd: calculated.reduce((sum, item) => sum + item.apiCost.estimatedUsd!, 0), calculatedCount: calculated.length, unavailableCount: items.length - calculated.length };
}
