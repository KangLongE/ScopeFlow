import { prisma } from "@/lib/db/prisma";
import { ApiError, notFound } from "@/lib/errors";
import { requireOwner } from "@/lib/auth/permissions";
import type { SessionContext } from "@/lib/auth/session";
import { audit } from "./shared";

export async function exportWorkspace(context: SessionContext) {
  requireOwner(context);
  const snapshot = await prisma.$transaction(async db => {
    const workspace = await db.workspace.findUnique({ where: { id: context.workspaceId }, select: { id: true, name: true, createdAt: true, creditLimit: true, userCreditLimit: true } });
    if (!workspace) throw notFound("WORKSPACE_NOT_FOUND", "워크스페이스를 찾을 수 없습니다.");
    if (await db.project.count({ where: { workspaceId: workspace.id } }) > 1000) throw new ApiError("EXPORT_TOO_LARGE", "온라인 내보내기 한도를 초과했습니다. 운영자에게 별도 내보내기를 요청해주세요.", 413);
    const clients = await db.client.findMany({ where: { workspaceId: workspace.id }, orderBy: { createdAt: "asc" } });
    const projects = await db.project.findMany({ where: { workspaceId: workspace.id }, orderBy: { createdAt: "asc" }, select: {
      id: true, workspaceId: true, clientId: true, name: true, status: true, budget: true, deadline: true, referenceUrl: true, notes: true, revision: true, contextReview: true, deletedAt: true, createdAt: true, updatedAt: true,
      initialRequest: true, questions: { include: { answer: true }, orderBy: { position: "asc" } }, requirements: { orderBy: { createdAt: "asc" } },
      estimate: { select: { id: true, rates: true, overrideTotal: true, adjustmentReason: true, items: true } },
      scopes: { select: { id: true, projectId: true, majorVersion: true, minorVersion: true, status: true, basedOnRevision: true, document: true, approvedAt: true, approvedBy: true, createdAt: true }, orderBy: [{ majorVersion: "asc" }, { minorVersion: "asc" }] },
      changeRequests: { select: { id: true, projectId: true, number: true, baseScopeId: true, resultScopeId: true, request: true, review: true, status: true, rates: true, amount: true, adjustmentReason: true, reviewedBy: true, approvedAt: true, approvedBy: true, revision: true, createdAt: true }, orderBy: { number: "asc" } }, feedback: { orderBy: { createdAt: "asc" } },
    } });
    const usage = await db.aIUsage.findMany({ where: { workspaceId: workspace.id }, orderBy: { createdAt: "asc" }, select: { id: true, projectId: true, action: true, status: true, creditsUsed: true, creditState: true, errorCode: true, provider: true, model: true, inputTokens: true, outputTokens: true, cached: true, createdAt: true } });
    return { schemaVersion: 1, exportedAt: new Date().toISOString(), workspace, clients, projects, usage };
  }, { isolationLevel: "RepeatableRead", timeout: 30000 });
  const body = JSON.stringify(snapshot, null, 2);
  if (Buffer.byteLength(body, "utf8") > 4_000_000) throw new ApiError("EXPORT_TOO_LARGE", "온라인 내보내기 파일 한도를 초과했습니다. 운영자에게 별도 내보내기를 요청해주세요.", 413);
  await audit(prisma, context, "WORKSPACE_EXPORTED", "Workspace", context.workspaceId, undefined, { projectCount: snapshot.projects.length, bytes: Buffer.byteLength(body, "utf8") });
  return body;
}
