import { createHash, randomUUID } from "node:crypto";
import { type ZodType } from "zod";
import { Prisma, type AIAction, type AIUsage } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getEnv } from "@/lib/env";
import { ApiError } from "@/lib/errors";
import type { SessionContext } from "@/lib/auth/session";
import { requireOwner } from "@/lib/auth/permissions";
import { projectFor } from "@/lib/services/shared";
import { GroqProvider } from "./groq.provider";
import { prompts } from "./prompts";
import { buildProjectAIContext, type ProjectAIContext } from "@/lib/services/ai-context.service";
import { validateAIResult, type ValidationResult } from "./rule-validator";
import { AIResponseError } from "./provider";
import { credits, creditPreview, policyRevision, modelPrice, apiCost, historicalCost, costSummary, executionFingerprint, type AIExecutionOptions } from "./usage-policy";
export { creditCost } from "./usage-policy";

const provider = new GroqProvider();
const jsonValue = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
function monthStart() { const now = new Date(); return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)); }
function requestHash(action: AIAction, model: string, version: string, input: unknown) { return createHash("sha256").update(JSON.stringify({ provider: provider.name, action, model, version, input })).digest("hex"); }

async function balance(db: Prisma.TransactionClient | typeof prisma, context: SessionContext) {
  const workspace = await db.workspace.findUnique({ where: { id: context.workspaceId }, select: { creditLimit: true, userCreditLimit: true } });
  if (!workspace) throw new ApiError("WORKSPACE_NOT_FOUND", "워크스페이스를 찾을 수 없습니다.", 404);
  const rows = await db.aIUsage.groupBy({ by: ["status", "userId"], where: { workspaceId: context.workspaceId, status: { in: ["SUCCESS", "PENDING"] }, createdAt: { gte: monthStart() } }, _sum: { creditsUsed: true } });
  const sum = (status: "SUCCESS" | "PENDING", user = false) => rows.filter(r => r.status === status && (!user || r.userId === context.userId)).reduce((total, r) => total + (r._sum.creditsUsed ?? 0), 0);
  const available = { workspace: { used: sum("SUCCESS"), reserved: sum("PENDING"), limit: workspace.creditLimit }, user: { used: sum("SUCCESS", true), reserved: sum("PENDING", true), limit: workspace.userCreditLimit } };
  return { ...available, availableCredits: Math.max(0, Math.min(available.workspace.limit - available.workspace.used - available.workspace.reserved, available.user.limit - available.user.used - available.user.reserved)) };
}
export function executionView(usage: AIUsage) {
  const unknown = usage.status === "PENDING" && Date.now() - usage.createdAt.valueOf() > getEnv().AI_TIMEOUT_MS + 30000;
  const state = unknown ? "UNKNOWN" : usage.status === "PENDING" ? "RUNNING" : usage.status === "FAILED" ? "FAILED" : usage.delivery ? "COMPLETED" : "RESULT_READY";
  return { runId: usage.id, executionKey: usage.executionKey, state, creditState: unknown ? "UNKNOWN" : usage.creditState ?? (usage.status === "SUCCESS" ? usage.creditsUsed === 0 ? "NOT_CHARGED" : "CHARGED" : usage.status === "FAILED" ? "NOT_CHARGED" : "UNKNOWN"), creditsUsed: usage.status === "SUCCESS" ? usage.creditsUsed : usage.status === "FAILED" ? 0 : null, apiCost: historicalCost(usage), error: usage.errorMessage, errorCode: usage.errorCode, validationStatus: (usage.validation as { status?: string } | null)?.status ?? null, contextStatus: usage.contextStatus };
}

export async function generateAI<T>(context: SessionContext, projectId: string, action: AIAction, schema: ZodType<T>, options: { regenerate?: boolean; model?: "fast" | "standard" | "reasoning"; changeId?: string } & AIExecutionOptions = {}) {
  requireOwner(context);
  const input = await buildProjectAIContext(context, projectId, action, { changeId: options.changeId });
  if (Buffer.byteLength(JSON.stringify(input), "utf8") > 240_000) throw new ApiError("AI_CONTEXT_TOO_LARGE", "고객 조건과 승인 범위를 모두 전달하기에는 입력이 너무 큽니다. 입력을 정리한 뒤 다시 실행해주세요.", 413);
  const env = getEnv();
  const model = options.model === "fast" ? env.AI_FAST_MODEL : options.model === "reasoning" ? env.AI_REASONING_MODEL : env.AI_STANDARD_MODEL;
  const prompt = prompts[action];
  const hash = requestHash(action, model, prompt.version, input);
  const key = options.executionKey ?? randomUUID();
  const fingerprint = options.requestFingerprint ?? executionFingerprint({ projectId, action, regenerate: !!options.regenerate, changeId: options.changeId ?? null, input: input.inputFingerprint });
  const price = modelPrice(env.AI_MODEL_PRICES, model);
  const started = await prisma.$transaction(async tx => {
    // Reserve inside the same lock as the limit check; do not hold a DB transaction during Groq.
    await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))::text", context.workspaceId);
    const existing = await tx.aIUsage.findFirst({ where: { workspaceId: context.workspaceId, userId: context.userId, executionKey: key } });
    if (existing) {
      if (existing.requestFingerprint !== fingerprint) throw new ApiError("AI_EXECUTION_CONFLICT", "같은 실행 요청의 입력이 달라졌습니다. 원래 실행 상태를 확인한 뒤 새로 실행해주세요.", 409);
      return { usage: existing, cached: null, replay: true };
    }
    const balances = await balance(tx, context);
    const cached = !options.regenerate ? await tx.aIResultCache.findFirst({ where: { workspaceId: context.workspaceId, hash, expiresAt: { gt: new Date() }, result: { not: Prisma.JsonNull } } }) : null;
    const preview = creditPreview(action, balances.workspace, balances.user, !!cached);
    if (options.policyRevision && options.policyRevision !== policyRevision() && options.policyRevision !== preview.policyRevision) throw new ApiError("AI_POLICY_CHANGED", "Credit 비용 정책 또는 캐시 상태가 변경되었습니다. 새 비용을 확인한 뒤 다시 실행해주세요.", 409, { creditPreview: preview });
    const cost = cached ? 0 : credits[action];
    if (balances.availableCredits < cost) throw new ApiError("AI_CREDIT_EXCEEDED", preview.blockReason ?? "사용 가능한 Credit이 부족합니다.", 429, { creditPreview: preview });
    const limitKey = context.workspaceId + ":" + context.userId + ":ai";
    const now = new Date();
    const limit = await tx.requestLimit.findUnique({ where: { key: limitKey } });
    if (limit && limit.resetAt > now && limit.count >= 10) throw new ApiError("AI_RATE_LIMITED", "AI 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.", 429);
    await tx.requestLimit.upsert({ where: { key: limitKey }, create: { key: limitKey, count: 1, resetAt: new Date(now.valueOf() + 60_000) }, update: limit && limit.resetAt > now ? { count: { increment: 1 } } : { count: 1, resetAt: new Date(now.valueOf() + 60_000) } });
    const usage = await tx.aIUsage.create({ data: { workspaceId: context.workspaceId, userId: context.userId, projectId, action, provider: provider.name, model, creditsUsed: cost, executionKey: key, requestFingerprint: fingerprint, policyRevision: policyRevision(), creditState: cost ? "RESERVED" : "NOT_CHARGED", costStatus: cached ? "estimated" : price ? "usage_missing" : "unconfigured", priceSnapshot: cached ? { cached: true } : price ? jsonValue(price) : Prisma.JsonNull, promptVersion: prompt.version, inputSnapshot: jsonValue(input), inputFingerprint: input.inputFingerprint, baselineScopeId: input.approvedBaseline?.id, baselineVersion: input.approvedBaseline?.version, cached: !!cached } });
    return { usage, cached, replay: false };
  }, { timeout: 15000 });
  const { usage, cached } = started;
  if (started.replay) {
    if (usage.status === "FAILED") throw new ApiError(usage.errorCode ?? "AI_PROVIDER_ERROR", usage.errorMessage ?? "AI 실행이 실패했습니다. 새 실행을 선택하기 전에 비용을 확인해주세요.", 502, { execution: executionView(usage) });
    if (usage.status === "PENDING") throw new ApiError("AI_EXECUTION_PENDING", "이미 실행 중입니다. 새 호출 없이 실행 상태를 확인해주세요.", 409, { execution: executionView(usage) });
    return { data: usage.result as T, runId: usage.id, context: usage.inputSnapshot as unknown as ProjectAIContext, inputFingerprint: usage.inputFingerprint!, stale: usage.contextStatus === "CHANGED", validation: usage.validation as unknown as ValidationResult };
  }
  try {
    const result = cached?.result ? { data: cached.result as T, rawResponse: JSON.stringify(cached.result), inputTokens: 0, outputTokens: 0, cachedTokens: 0, usageKnown: true } : await provider.generate({ model, systemPrompt: prompt.text, input, schema });
    const validation = validateAIResult(input, result.data);
    const current = await buildProjectAIContext(context, projectId, action, { changeId: options.changeId });
    const stale = current.inputFingerprint !== input.inputFingerprint;
    const cost = apiCost(price, result, !!cached);
    await prisma.$transaction([
      prisma.aIUsage.update({ where: { id: usage.id }, data: { status: "SUCCESS", creditState: usage.creditsUsed ? "CHARGED" : "NOT_CHARGED", inputTokens: result.inputTokens, outputTokens: result.outputTokens, cachedTokens: result.cachedTokens, estimatedCost: cost.estimatedUsd ?? 0, costStatus: cost.status, result: result.data === null ? Prisma.JsonNull : jsonValue(result.data), rawResponse: result.rawResponse, validation: jsonValue(validation), contextStatus: stale ? "CHANGED" : "READY" } }),
      prisma.aIResultCache.upsert({ where: { workspaceId_hash: { workspaceId: context.workspaceId, hash } }, create: { workspaceId: context.workspaceId, hash, action, result: result.data === null ? Prisma.JsonNull : jsonValue(result.data), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), leaseUntil: new Date() }, update: { action, result: result.data === null ? Prisma.JsonNull : jsonValue(result.data), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), leaseUntil: new Date() } }),
    ]);
    return { data: result.data, runId: usage.id, context: input, inputFingerprint: input.inputFingerprint, stale, validation };
  } catch (error) {
    const failure = error instanceof ApiError ? error : new ApiError("AI_PROVIDER_ERROR", "AI 처리 중 오류가 발생했습니다. 실행 상태를 확인한 뒤 다시 시도해주세요.", 502);
    const failed = await prisma.aIUsage.update({ where: { id: usage.id }, data: { status: "FAILED", creditState: "NOT_CHARGED", errorCode: failure.code, errorMessage: failure.message, ...(error instanceof AIResponseError ? { rawResponse: error.rawResponse } : {}) } });
    throw new ApiError(failure.code, failure.message, failure.status, { ...failure.details, execution: executionView(failed) });
  }
}

export const aiUsageService = {
  async preview(context: SessionContext, projectId: string, action: AIAction, regenerate: boolean, changeId?: string) {
    requireOwner(context);
    const input = await buildProjectAIContext(context, projectId, action, { changeId });
    const env = getEnv();
    const model = action === "QUESTIONS" ? env.AI_FAST_MODEL : action === "SCOPE_COMPARISON" ? env.AI_REASONING_MODEL : env.AI_STANDARD_MODEL;
    const cached = !regenerate ? await prisma.aIResultCache.findFirst({ where: { workspaceId: context.workspaceId, hash: requestHash(action, model, prompts[action].version, input), expiresAt: { gt: new Date() }, result: { not: Prisma.JsonNull } }, select: { id: true } }) : null;
    const balances = await balance(prisma, context);
    return { preview: creditPreview(action, balances.workspace, balances.user, !!cached) };
  },
  async current(context: SessionContext) {
    const balances = await balance(prisma, context);
    const rows = await prisma.aIUsage.findMany({ where: { workspaceId: context.workspaceId, createdAt: { gte: monthStart() } }, orderBy: { createdAt: "desc" } });
    const items = rows.map(u => ({ id: u.id, action: u.action, provider: u.provider, model: u.model, inputTokens: u.inputTokens, outputTokens: u.outputTokens, cachedTokens: u.cachedTokens, creditsUsed: u.status === "SUCCESS" ? u.creditsUsed : u.status === "FAILED" ? 0 : null, reservedCredits: u.status === "PENDING" ? u.creditsUsed : 0, creditState: executionView(u).creditState, apiCost: historicalCost(u), priceSnapshot: u.priceSnapshot, promptVersion: u.promptVersion, status: u.status, cached: u.cached, createdAt: u.createdAt }));
    const env = getEnv();
    return { asOf: Date.now(), month: monthStart().toISOString().slice(0, 7), ...balances, previews: Object.keys(credits).map(action => creditPreview(action as AIAction, balances.workspace, balances.user)), costSummary: costSummary(items), items, config: { provider: env.AI_PROVIDER, fastModel: env.AI_FAST_MODEL, standardModel: env.AI_STANDARD_MODEL, reasoningModel: env.AI_REASONING_MODEL, timeoutMs: env.AI_TIMEOUT_MS } };
  },
  async find(context: SessionContext, key: string, fingerprint?: string) {
    const usage = await prisma.aIUsage.findFirst({ where: { workspaceId: context.workspaceId, userId: context.userId, executionKey: key } });
    if (!usage) return null;
    await projectFor(context, usage.projectId);
    if (fingerprint && usage.requestFingerprint !== fingerprint) throw new ApiError("AI_EXECUTION_CONFLICT", "같은 실행 요청의 입력이 달라졌습니다. 원래 실행 상태를 확인한 뒤 새로 실행해주세요.", 409);
    return { usage, execution: executionView(usage) };
  },
  async execution(context: SessionContext, key: string) {
    const found = await this.find(context, key);
    if (!found) throw new ApiError("AI_EXECUTION_NOT_FOUND", "실행 상태를 확인하지 못했습니다. 자동으로 새 AI 요청을 보내지 않습니다.", 404);
    return { execution: found.execution, result: found.usage.status === "SUCCESS" ? found.usage.delivery ?? found.usage.result : null, availableCredits: (await balance(prisma, context)).availableCredits };
  },
};
