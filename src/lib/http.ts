import { NextResponse } from "next/server";
import { z } from "zod";
import { appUrl } from "./auth";
import { AppError } from "./security";
export async function readBody(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("요청 내용이 없습니다.");
  let size = 0; const chunks: Uint8Array[] = [];
  for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 256000) { await reader.cancel(); throw new AppError("입력 내용이 너무 큽니다.", 413); } chunks.push(value); }
  try { return z.record(z.string(), z.unknown()).parse(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { throw new AppError("요청 형식이 올바르지 않습니다."); }
}
export function checkOrigin(request: Request) {
  if (request.headers.get("origin") !== new URL(appUrl).origin) throw new AppError("허용되지 않은 요청입니다.", 403);
}
export function errorResponse(error: unknown) {
  if (error instanceof AppError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof z.ZodError) return NextResponse.json({ error: `입력값을 확인해주세요: ${error.issues[0]?.path.join(".") || "필수 항목"}` }, { status: 400 });
  console.error("ScopeFlow request failed", error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : "Unknown error");
  return NextResponse.json({ error: "처리 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요." }, { status: 500 });
}
