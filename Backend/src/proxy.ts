import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

const allowedHeaders = "Content-Type, X-Workspace-Id, X-Request-Id";

export function proxy(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") || randomUUID();
  const origin = request.headers.get("origin");
  const allowed = process.env.FRONTEND_URL;
  const allowedOrigins = new Set(allowed ? [allowed] : []);
  if (allowed) {
    const frontend = new URL(allowed);
    if (frontend.hostname === "localhost") allowedOrigins.add(`${frontend.protocol}//127.0.0.1${frontend.port ? `:${frontend.port}` : ""}`);
    if (frontend.hostname === "127.0.0.1") allowedOrigins.add(`${frontend.protocol}//localhost${frontend.port ? `:${frontend.port}` : ""}`);
  }
  if (origin && !allowedOrigins.has(origin)) return NextResponse.json({ error: { code: "ORIGIN_NOT_ALLOWED", message: "Origin not allowed", requestId } }, { status: 403 });
  const headers = new Headers({ "X-Request-Id": requestId, "Vary": "Origin" });
  if (origin && allowedOrigins.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    headers.set("Access-Control-Allow-Headers", allowedHeaders);
  }
  if (request.method === "OPTIONS") return new NextResponse(null, { status: 204, headers });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  headers.forEach((value, key) => response.headers.set(key, value));
  return response;
}

export const config = { matcher: ["/api/:path*"] };
