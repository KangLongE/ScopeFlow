import { backendBaseUrl } from "@/lib/api";

type Context = { params: Promise<{ all: string[] }> };

async function proxy(request: Request, context: Context) {
  const { all } = await context.params;
  const source = new URL(request.url);
  const headers = new Headers(request.headers);
  headers.delete("host"); headers.delete("content-length");
  const body = request.method === "GET" ? undefined : await request.arrayBuffer();
  let response: Response;
  try { response = await fetch(`${backendBaseUrl()}/api/auth/${all.map(encodeURIComponent).join("/")}${source.search}`, { method: request.method, headers, body, redirect: "manual" }); }
  catch { return Response.json({ error: { message: "백엔드 서버에 연결할 수 없습니다." } }, { status: 502 }); }
  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete("content-length"); responseHeaders.delete("content-encoding");
  return new Response(response.body, { status: response.status, headers: responseHeaders });
}

export const GET = proxy;
export const POST = proxy;
