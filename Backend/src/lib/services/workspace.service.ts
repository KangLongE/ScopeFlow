import { prisma } from "@/lib/db/prisma";
import { notFound } from "@/lib/errors";
import { defaultRates } from "@/lib/model";
import { requireOwner } from "@/lib/auth/permissions";
import type { SessionContext } from "@/lib/auth/session";

export const workspaceService = {
  list(userId: string) {
    return prisma.workspace.findMany({ where: { members: { some: { userId } } }, include: { members: { where: { userId }, select: { role: true } } }, orderBy: { createdAt: "asc" } });
  },
  create(userId: string, name: string) {
    return prisma.workspace.create({ data: { name, members: { create: { userId, role: "OWNER" } }, rateCard: { create: { rates: defaultRates } } } });
  },
  async get(context: SessionContext) {
    const workspace = await prisma.workspace.findUnique({ where: { id: context.workspaceId }, include: { members: { select: { id: true, role: true, createdAt: true, user: { select: { id: true, name: true, email: true } } } }, rateCard: true, auditLogs: { orderBy: { createdAt: "desc" }, take: 5 } } });
    if (!workspace) throw notFound("WORKSPACE_NOT_FOUND", "워크스페이스를 찾을 수 없습니다.");
    return workspace;
  },
  update(context: SessionContext, name: string | undefined) {
    requireOwner(context);
    return prisma.workspace.update({ where: { id: context.workspaceId }, data: { name } });
  },
};
