import { z } from "zod";
import { auth } from "./auth";
import { prisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/errors";
import { setLogContext } from "@/lib/http";
import type { WorkspaceRole } from "@/generated/prisma/enums";

const uuid = z.string().uuid();

export type SessionContext = { userId: string; workspaceId: string; role: WorkspaceRole };

export async function requireUser(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new ApiError("UNAUTHENTICATED", "로그인이 필요합니다.", 401);
  setLogContext({ userId: session.user.id });
  return session;
}

export async function requireWorkspace(request: Request, requestedId?: string): Promise<SessionContext> {
  const session = await requireUser(request);
  const workspaceId = uuid.parse(requestedId ?? request.headers.get("x-workspace-id"));
  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: session.user.id } },
  });
  if (!membership) throw new ApiError("WORKSPACE_FORBIDDEN", "워크스페이스 접근 권한이 없습니다.", 403);
  setLogContext({ workspaceId });
  return { userId: session.user.id, workspaceId, role: membership.role };
}
