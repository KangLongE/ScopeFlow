import { AsyncLocalStorage } from "node:async_hooks";
import { ZodError, type ZodType } from "zod";
import { ApiError } from "./errors";

type Params = Record<string, string>;
type RouteContext<P extends Params> = { params: Promise<P> };
type LogContext = { requestId: string; userId?: string; workspaceId?: string };
const requestContext = new AsyncLocalStorage<LogContext>();

export function setLogContext(value: Omit<LogContext, "requestId">) { Object.assign(requestContext.getStore() ?? {}, value); }

export const json = (data: unknown, status = 200) => Response.json(data, { status });

export async function parseBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 1_000_000) throw new ApiError("PAYLOAD_TOO_LARGE", "요청 본문이 너무 큽니다.", 413);
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new ApiError("INVALID_JSON", "올바른 JSON 본문이 필요합니다.", 400);
  }
  return schema.parse(value);
}

export function route<P extends Params = Params>(
  handler: (request: Request, params: P) => Promise<Response>,
) {
  return async (request: Request, context?: RouteContext<P>) => {
    const startedAt = performance.now();
    const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
    return requestContext.run({ requestId }, async () => {
      try {
        const response = await handler(request, context ? await context.params : ({} as P));
        response.headers.set("x-request-id", requestId);
        console.info(JSON.stringify({ ...requestContext.getStore(), method: request.method, route: new URL(request.url).pathname, status: response.status, durationMs: Math.round(performance.now() - startedAt) }));
        return response;
      } catch (error) {
        const known = error instanceof ApiError;
        const validation = error instanceof ZodError;
        const status = known ? error.status : validation ? 422 : 500;
        const code = known ? error.code : validation ? "VALIDATION_ERROR" : "INTERNAL_ERROR";
        const message = known ? error.message : validation ? "입력값을 확인해주세요." : "서버 오류가 발생했습니다.";
        console.error(JSON.stringify({ ...requestContext.getStore(), method: request.method, route: new URL(request.url).pathname, status, durationMs: Math.round(performance.now() - startedAt), error: known ? error.code : validation ? "VALIDATION_ERROR" : error instanceof Error ? error.name : "UnknownError" }));
        return Response.json({ error: { code, message, requestId, ...(validation ? { details: error.issues } : {}) } }, { status, headers: { "x-request-id": requestId } });
      }
    });
  };
}
