import { NextRequest, NextResponse } from "next/server";
import { backendApi, BackendError } from "@/lib/api";
export async function GET(request: NextRequest) {
  try {
    const memberships = await backendApi<{ id: string }[]>("/api/v1/workspaces", { requestHeaders: request.headers });
    const selected = request.cookies.get("scopeflow-workspace")?.value;
    const workspaceId = (memberships.find(w => w.id === selected) ?? memberships[0])?.id;
    if (!workspaceId) return NextResponse.json({ error: "먼저 Workspace를 만들어주세요." }, { status: 409 });
    const key = request.nextUrl.searchParams.get("executionKey");
    const query = new URLSearchParams();
    if (key) query.set("executionKey", key);
    for (const name of ["operation", "projectId", "changeId", "regenerate"]) { const value = request.nextUrl.searchParams.get(name); if (value !== null) query.set(name, value); }
    const data = await backendApi("/api/v1/ai/usage" + (query.size ? "?" + query.toString() : ""), { workspaceId, requestHeaders: request.headers });
    return NextResponse.json(data, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof BackendError ? error.message : "Credit 정보를 확인하지 못했습니다. 다시 확인해주세요." }, { status: error instanceof BackendError ? error.status : 502 });
  }
}
