import { and, eq, gte, lt, or } from "drizzle-orm";
import { db } from "../db";
import * as s from "../db/schema";
import { AppError, audit, hashToken, limitRequest, type Context } from "../security";
import { modelFor, prompts, type AIAction } from "./prompts";
import { aiBaseUrl, aiConfigured, configuredProvider, provider, ProviderError, timeoutMs } from "./provider";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
}
export async function generate(ctx: Context, projectId: string, action: AIAction, input: unknown, options: { force?: boolean; complex?: boolean } = {}) {
  if (!aiConfigured()) throw new AppError("AI가 아직 연결되지 않았습니다. AI 설정을 확인하거나 직접 입력으로 진행해주세요.", 503);
  const serialized = JSON.stringify(canonical(input));
  if (serialized.length > 24000) throw new AppError("AI 입력이 너무 큽니다. 관련 요구사항을 간결하게 정리해주세요.");
  await limitRequest(`ai:${ctx.userId}`, 8);
  const model = modelFor(action, options.complex);
  const hash = hashToken(JSON.stringify({ prompt: prompts[action].version, input: serialized, model, projectId, provider: `${configuredProvider()}:${aiBaseUrl()}` }));
  const month = new Date(); month.setUTCDate(1); month.setUTCHours(0,0,0,0);
  const lease = new Date(Date.now() + timeoutMs() + 60000);
  const reservation = await db.transaction(async tx => {
    // Serialize reservations across both a user's workspaces and a workspace's members.
    await tx.select({ id: s.user.id }).from(s.user).where(eq(s.user.id, ctx.userId)).for("update");
    const [workspace] = await tx.select().from(s.workspaces).where(eq(s.workspaces.id, ctx.workspaceId)).for("update");
    const [cached] = await tx.select().from(s.aiCache).where(and(eq(s.aiCache.workspaceId, ctx.workspaceId), eq(s.aiCache.hash, hash)));
    if (cached && cached.leaseUntil > new Date()) throw new AppError("동일한 AI 요청을 처리 중입니다. 잠시 후 확인해주세요.", 409);
    if (cached?.result && !options.force) return { cached: prompts[action].schema.parse(cached.result) };
    await tx.update(s.aiUsage).set({ status: "FAILED", creditsUsed: 0 }).where(and(eq(s.aiUsage.status, "PENDING"), lt(s.aiUsage.createdAt, new Date(Date.now() - timeoutMs() - 120000)), or(eq(s.aiUsage.workspaceId, ctx.workspaceId), eq(s.aiUsage.userId, ctx.userId))));
    const rows = await tx.select({ workspaceId: s.aiUsage.workspaceId, userId: s.aiUsage.userId, credits: s.aiUsage.creditsUsed }).from(s.aiUsage).where(and(gte(s.aiUsage.createdAt, month), or(eq(s.aiUsage.workspaceId, ctx.workspaceId), eq(s.aiUsage.userId, ctx.userId))));
    const cost = workspace.creditCosts[action] ?? 2;
    if (rows.filter(r => r.workspaceId === ctx.workspaceId).reduce((sum,r) => sum+r.credits,0) + cost > workspace.creditLimit) throw new AppError("Workspace의 이번 달 AI Credit을 모두 사용했습니다.", 429);
    if (rows.filter(r => r.userId === ctx.userId).reduce((sum,r) => sum+r.credits,0) + cost > workspace.userCreditLimit) throw new AppError("사용자의 이번 달 AI Credit 한도를 초과했습니다.", 429);
    await tx.insert(s.aiCache).values({ workspaceId: ctx.workspaceId, hash, leaseUntil: lease }).onConflictDoUpdate({ target: [s.aiCache.workspaceId, s.aiCache.hash], set: { leaseUntil: lease } });
    const [usage] = await tx.insert(s.aiUsage).values({ workspaceId: ctx.workspaceId, userId: ctx.userId, projectId, action, model, promptVersion: prompts[action].version, creditsUsed: cost }).returning();
    return { usageId: usage.id };
  });
  if ("cached" in reservation) return { result: reservation.cached, cached: true };
  try {
    const response = await provider.generate(action, model, input);
    await db.transaction(async tx => {
      await tx.update(s.aiUsage).set({ ...response.usage, status: "SUCCESS" }).where(eq(s.aiUsage.id, reservation.usageId));
      await tx.update(s.aiCache).set({ result: response.result, leaseUntil: new Date(0) }).where(and(eq(s.aiCache.workspaceId, ctx.workspaceId), eq(s.aiCache.hash, hash), eq(s.aiCache.leaseUntil, lease)));
      await audit(tx, ctx, projectId, "AI_COMPLETED", `${action} · ${model} · ${prompts[action].version}`);
    });
    console.info("AI usage", { id: reservation.usageId, action, model, ...response.usage });
    return { result: response.result, cached: false };
  } catch (error) {
    await db.transaction(async tx => {
      await tx.update(s.aiUsage).set({ status: "FAILED", creditsUsed: 0, ...(error instanceof ProviderError ? error.usage : {}) }).where(eq(s.aiUsage.id, reservation.usageId));
      await tx.update(s.aiCache).set({ leaseUntil: new Date(0) }).where(and(eq(s.aiCache.workspaceId, ctx.workspaceId), eq(s.aiCache.hash, hash), eq(s.aiCache.leaseUntil, lease)));
    });
    console.error("AI generation failed", { usageId: reservation.usageId, action, model, reason: error instanceof Error ? error.message : "unknown" });
    if (error instanceof AppError) throw error;
    throw new AppError("AI 분석 중 문제가 발생했습니다. 다시 시도하거나 직접 입력으로 진행해주세요.", 502);
  }
}
