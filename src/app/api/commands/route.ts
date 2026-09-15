import { NextRequest, NextResponse } from "next/server";
import { auth, appUrl } from "@/lib/auth";
import { commandSchema, executeCommand } from "@/lib/commands";
import { AppError, contextFor, limitRequest } from "@/lib/security";
import { executeAI } from "@/lib/ai/commands";
import { executeChange } from "@/lib/changes";
import { checkOrigin, errorResponse, readBody } from "@/lib/http";

export const maxDuration = 120;
export async function POST(request: NextRequest) {
  try {
    checkOrigin(request);
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new AppError("로그인이 필요합니다.", 401);
    await limitRequest(`user:${session.user.id}`);
    const body = await readBody(request);
    if (body.action === "workspace.switch") {
      const cmd = commandSchema.parse(body);
      if (cmd.action !== "workspace.switch") throw new AppError("잘못된 요청입니다.");
      await contextFor(session.user.id, cmd.workspaceId);
      const response = NextResponse.json({ redirect: "/dashboard" });
      response.cookies.set("scopeflow-workspace", cmd.workspaceId, { httpOnly: true, sameSite: "lax", secure: appUrl.startsWith("https:"), path: "/" });
      return response;
    }
    if (body.action === "workspace.create") {
      const result = await executeCommand({ userId: session.user.id, workspaceId: "", role: "OWNER" }, body);
      const workspaceId = new URL(result.redirect!, appUrl).searchParams.get("workspace")!;
      const response = NextResponse.json({ redirect: "/dashboard" });
      response.cookies.set("scopeflow-workspace", workspaceId, { httpOnly: true, sameSite: "lax", secure: appUrl.startsWith("https:"), path: "/" });
      return response;
    }
    const ctx = await contextFor(session.user.id, request.cookies.get("scopeflow-workspace")?.value);
    if (typeof body.action === "string" && body.action.startsWith("ai.")) return NextResponse.json(await executeAI(ctx, body));
    if (typeof body.action === "string" && body.action.startsWith("change.")) return NextResponse.json(await executeChange(ctx, body));
    return NextResponse.json(await executeCommand(ctx, body));
  } catch (error) { return errorResponse(error); }
}
