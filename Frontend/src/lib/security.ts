import { and, eq, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db, type Transaction } from "./db";
import { auditLogs, members, projects, requestLimits } from "./db/schema";

export class AppError extends Error { constructor(message: string, public status = 400) { super(message); } }
export type Context = { userId: string; workspaceId: string; role: "OWNER" | "MEMBER" };
export const hashToken = (value: string) => createHash("sha256").update(value).digest("hex");
export function owner(ctx: Context) { if (ctx.role !== "OWNER") throw new AppError("Workspace 소유자만 실행할 수 있습니다.", 403); }
export async function contextFor(userId: string, workspaceId?: string) {
  const [member] = await db.select().from(members).where(workspaceId ? and(eq(members.userId, userId), eq(members.workspaceId, workspaceId)) : eq(members.userId, userId)).orderBy(members.createdAt).limit(1);
  if (!member) throw new AppError("Workspace를 먼저 만들어주세요.", 403);
  return { userId, workspaceId: member.workspaceId, role: member.role } satisfies Context;
}
export async function projectFor(ctx: Context, projectId: string, tx: Transaction | typeof db = db, lock = false) {
  const query = tx.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.workspaceId, ctx.workspaceId)));
  const [project] = await (lock ? query.for("update") : query);
  if (!project) throw new AppError("프로젝트를 찾을 수 없습니다.", 404);
  return project;
}
export async function audit(tx: Transaction, ctx: Context, projectId: string | null, event: string, detail: string) {
  await tx.insert(auditLogs).values({ workspaceId: ctx.workspaceId, projectId, actor: ctx.userId, event, detail });
}
export async function limitRequest(key: string, max = 60, seconds = 60) {
  const now = new Date();
  const [entry] = await db.insert(requestLimits).values({ key, count: 1, resetAt: new Date(now.getTime() + seconds * 1000) }).onConflictDoUpdate({
    target: requestLimits.key,
    set: { count: sql`CASE WHEN ${requestLimits.resetAt} <= ${now} THEN 1 ELSE ${requestLimits.count} + 1 END`, resetAt: sql`CASE WHEN ${requestLimits.resetAt} <= ${now} THEN ${new Date(now.getTime() + seconds * 1000)} ELSE ${requestLimits.resetAt} END` },
  }).returning();
  if (entry.count > max) throw new AppError("요청이 너무 많습니다. 잠시 후 다시 시도해주세요.", 429);
}
