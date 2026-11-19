import { headers } from "next/headers";
import { getVercelOidcTokenSync } from "@vercel/oidc";

export class BackendError extends Error {
  constructor(message: string, public status: number, public code = "BACKEND_ERROR") { super(message); }
}

export function backendBaseUrl() {
  const url = (process.env.BACKEND_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
  if (process.env.VERCEL_ENV && (process.env.BACKEND_ENVIRONMENT !== process.env.VERCEL_ENV || !url.startsWith("https://"))) {
    throw new BackendError("현재 배포 환경과 Backend 연결 설정이 일치하지 않습니다.", 503, "BACKEND_ENVIRONMENT_MISMATCH");
  }
  return url;
}

export function backendFetch(path: string, options: RequestInit = {}) {
  const base = backendBaseUrl();
  if (!path.startsWith("/api/")) throw new Error("Expected a backend API path");
  const outgoing = new Headers(options.headers);
  for (const header of ["x-vercel-oidc-token", "x-vercel-trusted-oidc-idp-token", "x-vercel-protection-bypass"]) outgoing.delete(header);
  const cookies = outgoing.get("cookie");
  if (cookies) outgoing.set("cookie", cookies.split(";").map(value => value.trim()).filter(value => !value.startsWith("_vercel_")).join("; "));
  if (process.env.VERCEL_ENV === "preview") {
    // Only this branch's verified backend may receive the frontend deployment identity.
    if (base !== "https://scope-flow-backend-git-codex-preview-yakchat-s-projects.vercel.app") {
      throw new BackendError("Preview 백엔드 주소를 확인해주세요.", 503, "BACKEND_ENVIRONMENT_MISMATCH");
    }
    outgoing.set("x-vercel-trusted-oidc-idp-token", getVercelOidcTokenSync());
  }
  return fetch(base + path, { ...options, headers: outgoing, redirect: options.redirect === "manual" ? "manual" : "error" });
}

export async function backendApi<T>(path: string, options: { method?: string; body?: unknown; workspaceId?: string; requestHeaders?: Headers } = {}): Promise<T> {
  const incoming = options.requestHeaders ?? await headers();
  const requestHeaders = new Headers({ Accept: "application/json" });
  const cookie = incoming.get("cookie");
  if (cookie) requestHeaders.set("cookie", cookie);
  if (options.workspaceId) requestHeaders.set("x-workspace-id", options.workspaceId);
  let body: string | undefined;
  if (options.body !== undefined) { requestHeaders.set("content-type", "application/json"); body = JSON.stringify(options.body); }
  let response: Response;
  try { response = await backendFetch(path, { method: options.method ?? "GET", headers: requestHeaders, body, cache: "no-store" }); }
  catch { throw new BackendError("백엔드 서버에 연결할 수 없습니다.", 502, "BACKEND_UNAVAILABLE"); }
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null;
  if (!response.ok) throw new BackendError(data?.error?.message || "요청을 처리하지 못했습니다.", response.status, data?.error?.code);
  return data as T;
}
