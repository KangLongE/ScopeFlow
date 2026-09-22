import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { notFound } from "@/lib/errors";
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

