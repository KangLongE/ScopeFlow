import { NextRequest, NextResponse } from "next/server";
import { checkOrigin, errorResponse, readBody } from "@/lib/http";
import { executePortal, tokenFor } from "@/lib/client-portal";
import { AppError, limitRequest } from "@/lib/security";
export async function POST(request: NextRequest) {
  try {
    checkOrigin(request); const body = await readBody(request);
    if (typeof body.token !== "string") throw new AppError("유효하지 않은 공유 링크입니다.", 404);
    const token = await tokenFor(body.token); await limitRequest(`client:${token.id}`, 30);
    return NextResponse.json(await executePortal(body));
  } catch (error) { return errorResponse(error); }
}
