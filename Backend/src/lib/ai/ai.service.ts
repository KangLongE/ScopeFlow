import { createHash } from "node:crypto";
import { z, type ZodType } from "zod";
import { Prisma, type AIAction } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getEnv } from "@/lib/env";
import { ApiError } from "@/lib/errors";
import type { SessionContext } from "@/lib/auth/session";
import { GroqProvider } from "./groq.provider";
import { prompts } from "./prompts";

const credits: Record<AIAction, number> = { INITIAL_ANALYSIS: 2, QUESTIONS: 1, REQUIREMENTS: 2, ESTIMATE: 2, SCOPE_SUMMARY: 1, SCOPE_COMPARISON: 3 };
export const creditCost = (action: AIAction) => credits[action];
const provider = new GroqProvider();
const jsonValue = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

function monthStart() { const now = new Date(); return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)); }
function requestHash(action: AIAction, model: string, version: string, input: unknown) { return createHash("sha256").update(JSON.stringify({ provider: provider.name, action, model, version, input })).digest("hex"); }

async function preflight(context: SessionContext, action: AIAction) {
  const cost = creditCost(action);
  await prisma.$transaction(async (tx) => {
    // ponytail: one workspace lock is enough for MVP credit accuracy; use an atomic credit ledger if AI throughput becomes measurable.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${context.workspaceId}))`;
    const [workspace, total, userTotal] = await Promise.all([
      tx.workspace.findUnique({ where: { id: context.workspaceId } }),
      tx.aIUsage.aggregate({ where: { workspaceId: context.workspaceId, status: "SUCCESS", createdAt: { gte: monthStart() } }, _sum: { creditsUsed: true } }),
      tx.aIUsage.aggregate({ where: { workspaceId: context.workspaceId, userId: context.userId, status: "SUCCESS", createdAt: { gte: monthStart() } }, _sum: { creditsUsed: true } }),
    ]);
    if (!workspace) throw new ApiError("WORKSPACE_NOT_FOUND", "워크스페이스를 찾을 수 없습니다.", 404);
    if ((total._sum.creditsUsed ?? 0) + cost > workspace.creditLimit || (userTotal._sum.creditsUsed ?? 0) + cost > workspace.userCreditLimit) throw new ApiError("AI_CREDIT_EXCEEDED", "이번 달 AI 크레딧을 모두 사용했습니다.", 429);
    const key = `${context.workspaceId}:${context.userId}:ai`;
    const now = new Date();
    const limit = await tx.requestLimit.findUnique({ where: { key } });
    if (limit && limit.resetAt > now && limit.count >= 10) throw new ApiError("AI_RATE_LIMITED", "AI 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.", 429);
    await tx.requestLimit.upsert({ where: { key }, create: { key, count: 1, resetAt: new Date(now.valueOf() + 60_000) }, update: limit && limit.resetAt > now ? { count: { increment: 1 } } : { count: 1, resetAt: new Date(now.valueOf() + 60_000) } });
  });
}

export async function generateAI<T>(context: SessionContext, projectId: string, action: AIAction, input: unknown, schema: ZodType<T>, options: { regenerate?: boolean; model?: "fast" | "standard" | "reasoning" } = {}) {
  await preflight(context, action);
  const env = getEnv();
  const model = options.model === "fast" ? env.AI_FAST_MODEL : options.model === "reasoning" ? env.AI_REASONING_MODEL : env.AI_STANDARD_MODEL;
  const prompt = prompts[action];
  const hash = requestHash(action, model, prompt.version, input);
  if (!options.regenerate) {
    const cached = await prisma.aIResultCache.findFirst({ where: { workspaceId: context.workspaceId, hash, expiresAt: { gt: new Date() }, result: { not: Prisma.JsonNull } } });
    if (cached?.result) return schema.parse(cached.result);
  }
  const usage = await prisma.aIUsage.create({ data: { workspaceId: context.workspaceId, userId: context.userId, projectId, action, provider: provider.name, model, creditsUsed: credits[action], promptVersion: prompt.version } });
  try {
    const result = await provider.generate({ model, systemPrompt: prompt.text, input, schema });
    const prices = z.record(z.string(), z.object({ input: z.number().min(0), output: z.number().min(0) })).catch({}).parse(JSON.parse(env.AI_MODEL_PRICES));
    const price = prices[model];
    const estimatedCost = price ? (result.inputTokens * price.input + result.outputTokens * price.output) / 1_000_000 : 0;
    await prisma.$transaction([
      prisma.aIUsage.update({ where: { id: usage.id }, data: { status: "SUCCESS", inputTokens: result.inputTokens, outputTokens: result.outputTokens, cachedTokens: result.cachedTokens, estimatedCost } }),
      prisma.aIResultCache.upsert({ where: { workspaceId_hash: { workspaceId: context.workspaceId, hash } }, create: { workspaceId: context.workspaceId, hash, action, result: jsonValue(result.data), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), leaseUntil: new Date() }, update: { action, result: jsonValue(result.data), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), leaseUntil: new Date() } }),
    ]);
    return result.data;
  } catch (error) {
    await prisma.aIUsage.update({ where: { id: usage.id }, data: { status: "FAILED" } });
    if (error instanceof ApiError) throw error;
    throw new ApiError("AI_PROVIDER_ERROR", "AI 처리 중 오류가 발생했습니다.", 502);
  }
}

export const aiUsageService = {
  async current(context: SessionContext) {
    const [workspace, workspaceUsage, userUsage, items] = await Promise.all([
      prisma.workspace.findUnique({ where: { id: context.workspaceId }, select: { creditLimit: true, userCreditLimit: true } }),
      prisma.aIUsage.aggregate({ where: { workspaceId: context.workspaceId, status: "SUCCESS", createdAt: { gte: monthStart() } }, _sum: { creditsUsed: true, estimatedCost: true } }),
      prisma.aIUsage.aggregate({ where: { workspaceId: context.workspaceId, userId: context.userId, status: "SUCCESS", createdAt: { gte: monthStart() } }, _sum: { creditsUsed: true } }),
      prisma.aIUsage.findMany({ where: { workspaceId: context.workspaceId, createdAt: { gte: monthStart() } }, orderBy: { createdAt: "desc" } }),
    ]);
    const env = getEnv();
    return { month: monthStart().toISOString().slice(0, 7), workspace: { used: workspaceUsage._sum.creditsUsed ?? 0, limit: workspace?.creditLimit ?? 0 }, user: { used: userUsage._sum.creditsUsed ?? 0, limit: workspace?.userCreditLimit ?? 0 }, estimatedCost: workspaceUsage._sum.estimatedCost ?? 0, items, config: { provider: env.AI_PROVIDER, fastModel: env.AI_FAST_MODEL, standardModel: env.AI_STANDARD_MODEL, reasoningModel: env.AI_REASONING_MODEL, timeoutMs: env.AI_TIMEOUT_MS } };
  },
};
