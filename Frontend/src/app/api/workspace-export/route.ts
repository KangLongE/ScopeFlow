import { type NextRequest, NextResponse } from "next/server";
import { backendApi, BackendError } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (request.headers.get("sec-fetch-site") === "cross-site" || origin && origin !== request.nextUrl.origin) return NextResponse.json({ error: "허용되지 않은 요청입니다." }, { status: 403 });
  try {
    const memberships = await backendApi<{ id: string }[]>("/api/v1/workspaces", { requestHeaders: request.headers });
    const selected = request.cookies.get("scopeflow-workspace")?.value;
    const workspace = memberships.find(item => item.id === selected) ?? memberships[0];
    if (!workspace) return NextResponse.json({ error: "내보낼 워크스페이스가 없습니다." }, { status: 409 });
    const data = await backendApi<unknown>(`/api/v1/workspaces/${workspace.id}/export`, { workspaceId: workspace.id, requestHeaders: request.headers });
    return new Response(JSON.stringify(data, null, 2), { headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="scopeflow-${workspace.id}.json"`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof BackendError ? error.message : "데이터를 내보내지 못했습니다." }, { status: error instanceof BackendError ? error.status : 500, headers: { "Cache-Control": "no-store" } });
  }
}
