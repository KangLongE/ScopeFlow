import type { Prisma, Project } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ApiError, notFound } from "@/lib/errors";
import { requireEditable } from "@/lib/auth/permissions";
import type { SessionContext } from "@/lib/auth/session";

export type Db = Prisma.TransactionClient | typeof prisma;

export async function projectFor(context: SessionContext, projectId: string, db: Db = prisma) {
  const project = await db.project.findFirst({ where: { id: projectId, workspaceId: context.workspaceId, deletedAt: null } });
  if (!project) throw notFound("PROJECT_NOT_FOUND", "프로젝트를 찾을 수 없습니다.");
  return project;
}

export async function audit(db: Db, context: SessionContext, event: string, entityType: string, entityId?: string, projectId?: string, metadata: Prisma.InputJsonValue = {}) {
  await db.auditLog.create({ data: { workspaceId: context.workspaceId, projectId, userId: context.userId, event, entityType, entityId, metadata } });
}

// All project writes and customer decisions use the same row lock so approval
// cannot race with an edit or create two versions from the same base Scope.
export async function lockProject(db: Prisma.TransactionClient, projectId: string) {
  await db.$queryRaw`SELECT id FROM projects WHERE id = ${projectId}::uuid FOR UPDATE`;
}

export async function requireDraft(project: Project, db: Db = prisma) {
  requireEditable(project.status);
  if (await db.scope.count({ where: { projectId: project.id, status: { in: ["APPROVED", "WAITING_APPROVAL"] } } })) {
    throw new ApiError("SCOPE_FROZEN", "승인 요청 중인 범위는 회수 후 수정해주세요. 승인된 범위는 변경 요청으로 관리하세요.", 409);
  }
}

export async function editDraft<T>(context: SessionContext, projectId: string, edit: (db: Prisma.TransactionClient, project: Project) => Promise<T>) {
  return prisma.$transaction(async db => {
    await lockProject(db, projectId);
    const project = await projectFor(context, projectId, db);
    await requireDraft(project, db);
    const result = await edit(db, project);
    await db.project.update({ where: { id: projectId }, data: { revision: { increment: 1 } } });
    return result;
  }, { timeout: 15000 });
}
