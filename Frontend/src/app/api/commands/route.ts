import { NextRequest, NextResponse } from "next/server";
import { backendBaseUrl } from "@/lib/api";

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  try { if (origin && new URL(origin).host !== request.headers.get("host")) return NextResponse.json({ error: "허용되지 않은 요청입니다." }, { status: 403 }); }
  catch { return NextResponse.json({ error: "허용되지 않은 요청입니다." }, { status: 403 }); }
  if (Number(request.headers.get("content-length") ?? 0) > 256_000) return NextResponse.json({ error: "입력 내용이 너무 큽니다." }, { status: 413 });
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 }); }
  if (typeof body.action !== "string") return NextResponse.json({ error: "작업 종류를 확인해주세요." }, { status: 422 });
  const headers = new Headers({ "content-type": "application/json", accept: "application/json" });
  const cookie = request.headers.get("cookie");
  const workspaceId = request.cookies.get("scopeflow-workspace")?.value;
  if (cookie) headers.set("cookie", cookie);
  if (workspaceId) headers.set("x-workspace-id", workspaceId);
  let response: Response;
  try { response = await fetch(`${backendBaseUrl()}/api/v1/commands`, { method: "POST", headers, body: JSON.stringify(body), cache: "no-store" }); }
  catch { return NextResponse.json({ error: "백엔드 서버에 연결할 수 없습니다." }, { status: 502 }); }
  const data = await response.json().catch(() => null) as { error?: { message?: string }; workspaceId?: string; [key: string]: unknown } | null;
  if (!response.ok) return NextResponse.json({ error: data?.error?.message || "요청을 처리하지 못했습니다." }, { status: response.status });
  const result = { ...data }; delete result.workspaceId;
  const nextResponse = NextResponse.json(result);
  if (data?.workspaceId) nextResponse.cookies.set("scopeflow-workspace", data.workspaceId, { httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:", path: "/" });
  return nextResponse;
}
