import { headers } from "next/headers";

export class BackendError extends Error {
  constructor(message: string, public status: number, public code = "BACKEND_ERROR") { super(message); }
}

export function backendBaseUrl() {
  return (process.env.BACKEND_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
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
  try { response = await fetch(`${backendBaseUrl()}${path}`, { method: options.method ?? "GET", headers: requestHeaders, body, cache: "no-store" }); }
  catch { throw new BackendError("백엔드 서버에 연결할 수 없습니다.", 502, "BACKEND_UNAVAILABLE"); }
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null;
  if (!response.ok) throw new BackendError(data?.error?.message || "요청을 처리하지 못했습니다.", response.status, data?.error?.code);
  return data as T;
}
