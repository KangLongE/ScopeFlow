import { ApiError } from "@/lib/errors";
import type { SessionContext } from "./session";

export function requireOwner(context: SessionContext) {
  if (context.role !== "OWNER") throw new ApiError("OWNER_REQUIRED", "소유자 권한이 필요합니다.", 403);
}

export function requireEditable(status: string) {
  if (["COMPLETED", "CANCELLED"].includes(status)) throw new ApiError("PROJECT_LOCKED", "종료된 프로젝트는 수정할 수 없습니다.", 409);
}

