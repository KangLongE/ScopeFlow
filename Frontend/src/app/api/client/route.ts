import { NextRequest, NextResponse } from "next/server";
import { backendBaseUrl } from "@/lib/api";

async function call(path: string, body: unknown) {
  return fetch(`${backendBaseUrl()}${path}`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body), cache: "no-store" });
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  try { if (origin && new URL(origin).host !== request.headers.get("host")) return NextResponse.json({ error: "허용되지 않은 요청입니다." }, { status: 403 }); }
  catch { return NextResponse.json({ error: "허용되지 않은 요청입니다." }, { status: 403 }); }
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 }); }
  if (typeof body.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(body.token)) return NextResponse.json({ error: "유효하지 않은 공유 링크입니다." }, { status: 404 });
  const token = encodeURIComponent(body.token);
  let response: Response;
  try {
    if (body.action === "client.answer") response = await call(`/api/v1/client-access/${token}/questions/${encodeURIComponent(String(body.questionId))}/answer`, { content: body.content, author: body.name });
    else if (body.action === "client.decide" && body.decision !== "APPROVE") response = await call(`/api/v1/client-access/${token}/request-changes`, { name: body.name, message: body.message, decision: body.decision });
    else if (body.action === "client.decide") {
      const portal = await fetch(`${backendBaseUrl()}/api/v1/client-access/${token}`, { cache: "no-store" });
      const data = await portal.json().catch(() => null) as { purpose?: string; error?: { message?: string } } | null;
      if (!portal.ok) return NextResponse.json({ error: data?.error?.message || "공유 링크를 확인해주세요." }, { status: portal.status });
      response = await call(`/api/v1/client-access/${token}/${data?.purpose === "SCOPE" ? "scope" : "change-request"}/approve`, { name: body.name, consent: body.consent === "on" });
    } else return NextResponse.json({ error: "지원하지 않는 요청입니다." }, { status: 422 });
  } catch { return NextResponse.json({ error: "백엔드 서버에 연결할 수 없습니다." }, { status: 502 }); }
  const data = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  if (!response.ok) return NextResponse.json({ error: data?.error?.message || "요청을 처리하지 못했습니다." }, { status: response.status });
  return NextResponse.json({ message: body.action === "client.answer" ? "답변을 전달했습니다. 감사합니다." : body.decision === "APPROVE" ? "승인했습니다. 확인해주셔서 감사합니다." : "의견을 담당자에게 전달했습니다.", ...(body.decision && body.decision !== "APPROVE" ? { redirect: "/client/complete" } : {}) });
}
