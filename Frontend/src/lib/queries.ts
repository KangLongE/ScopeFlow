import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { and, desc, eq, gte } from "drizzle-orm";
import { auth } from "./auth";
import { db } from "./db";
import * as s from "./db/schema";
import { contextFor, projectFor, type Context } from "./security";

export const currentUser = cache(async () => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  return session.user;
});
export const currentContext = cache(async () => {
  const user = await currentUser();
  const selected = (await cookies()).get("scopeflow-workspace")?.value;
  let ctx: Context;
  try { ctx = await contextFor(user.id, selected); } catch {
    try { ctx = await contextFor(user.id); } catch { redirect("/onboarding"); }
  }
  const [workspace] = await db.select().from(s.workspaces).where(eq(s.workspaces.id, ctx.workspaceId));
  const memberships = await db.select({ id: s.workspaces.id, name: s.workspaces.name }).from(s.members).innerJoin(s.workspaces, eq(s.members.workspaceId, s.workspaces.id)).where(eq(s.members.userId, user.id));
  return { ...ctx, user, workspace, memberships };
});
export const getProject = cache(async (projectId: string) => {
  const ctx = await currentContext();
  let project;
  try { project = await projectFor(ctx, projectId); } catch { notFound(); }
  const [client] = await db.select().from(s.clients).where(eq(s.clients.id, project.clientId));
  return { ctx, project, client };
});
export async function projectData(projectId: string) {
  const base = await getProject(projectId);
  const [initial, questions, requirements, scopes, changes, estimate, tokens, feedback, audit] = await Promise.all([
    db.select().from(s.initialRequests).where(eq(s.initialRequests.projectId, projectId)),
    db.select({ question: s.questions, answer: s.answers }).from(s.questions).leftJoin(s.answers, eq(s.questions.id, s.answers.questionId)).where(eq(s.questions.projectId, projectId)).orderBy(s.questions.position, s.questions.createdAt),
    db.select().from(s.requirements).where(eq(s.requirements.projectId, projectId)).orderBy(s.requirements.createdAt),
    db.select().from(s.scopes).where(eq(s.scopes.projectId, projectId)).orderBy(desc(s.scopes.version)),
    db.select().from(s.changes).where(eq(s.changes.projectId, projectId)).orderBy(desc(s.changes.number)),
    db.select().from(s.estimates).where(eq(s.estimates.projectId, projectId)),
    db.select({ id: s.accessTokens.id, purpose: s.accessTokens.purpose, expiresAt: s.accessTokens.expiresAt, revokedAt: s.accessTokens.revokedAt, createdAt: s.accessTokens.createdAt }).from(s.accessTokens).where(eq(s.accessTokens.projectId, projectId)).orderBy(desc(s.accessTokens.createdAt)),
    db.select().from(s.feedback).where(eq(s.feedback.projectId, projectId)).orderBy(desc(s.feedback.createdAt)),
    db.select().from(s.auditLogs).where(eq(s.auditLogs.projectId, projectId)).orderBy(desc(s.auditLogs.createdAt)).limit(20),
  ]);
  const items = estimate[0] ? await db.select().from(s.estimateItems).where(eq(s.estimateItems.estimateId, estimate[0].id)) : [];
  return { ...base, initial: initial[0], questions, requirements, scopes, changes, estimate: estimate[0], items, tokens, feedback, audit };
}
export function monthStart() { const now = new Date(); return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)); }
export async function monthlyUsage(workspaceId: string) {
  return db.select().from(s.aiUsage).where(and(eq(s.aiUsage.workspaceId, workspaceId), gte(s.aiUsage.createdAt, monthStart()))).orderBy(desc(s.aiUsage.createdAt));
}
