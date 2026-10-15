import type { AuditLog } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { idSchema } from "@/lib/model";
export async function activities(workspaceId: string, logs: AuditLog[]) {
  const projectIds = logs.flatMap(log => log.projectId ? [log.projectId] : log.entityType === "Project" && log.entityId ? [log.entityId] : []).filter(id => idSchema.safeParse(id).success);
  const projects = await prisma.project.findMany({ where: { workspaceId, deletedAt: null, id: { in: projectIds } }, select: { id: true, name: true } });
  const visible = projects.map(project => project.id);
  const ids = logs.flatMap(log => {
    const metadata = log.metadata && typeof log.metadata === "object" ? log.metadata as Record<string, unknown> : {};
    return [log.entityId, typeof metadata.scopeId === "string" ? metadata.scopeId : null].filter((id): id is string => !!id && idSchema.safeParse(id).success);
  });
  const [scopes, changes, requirements, actors] = await Promise.all([
    prisma.scope.findMany({ where: { projectId: { in: visible }, id: { in: ids } }, select: { id: true, projectId: true, majorVersion: true, minorVersion: true } }),
    prisma.changeRequest.findMany({ where: { projectId: { in: visible }, id: { in: ids } }, select: { id: true, projectId: true, number: true, resultScopeId: true } }),
    prisma.requirement.findMany({ where: { projectId: { in: visible }, id: { in: ids } }, select: { id: true, projectId: true, title: true } }),
    prisma.user.findMany({ where: { id: { in: logs.flatMap(log => log.userId ? [log.userId] : []) }, memberships: { some: { workspaceId } } }, select: { id: true, name: true } }),
  ]);
  return logs.map(log => {
    const project = projects.find(p => p.id === (log.projectId ?? (log.entityType === "Project" ? log.entityId : null))) ?? null;
    const metadata = log.metadata && typeof log.metadata === "object" ? log.metadata as Record<string, unknown> : {};
    const scope = scopes.find(s => s.projectId === project?.id && (s.id === log.entityId || s.id === metadata.scopeId));
    const change = changes.find(c => c.projectId === project?.id && c.id === log.entityId);
    const requirement = requirements.find(r => r.projectId === project?.id && r.id === log.entityId);
    const task = typeof metadata.task === "string" ? metadata.task : null;
    const context = { project, actorName: actors.find(a => a.id === log.userId)?.name ?? (typeof metadata.approvedBy === "string" ? metadata.approvedBy : null), scopeVersion: scope ? scope.majorVersion + "." + scope.minorVersion : null, changeNumber: change?.number ?? null, requirementName: project ? typeof metadata.title === "string" ? metadata.title : requirement?.title ?? null : null, task, requirementCount: Number.isSafeInteger(metadata.count) && Number(metadata.count) >= 0 ? Number(metadata.count) : null, href: project && (scope || change || requirement || log.entityType === "Project") ? "/projects/" + project.id + (scope ? "/scope" : change ? "/changes" : requirement || task ? "/requirements" : "") : null };
    return { ...log, display: context };
  });
}
