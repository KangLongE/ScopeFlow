import { requireWorkspace } from "@/lib/auth/session";
import { route } from "@/lib/http";
import { idSchema } from "@/lib/model";
import { exportWorkspace } from "@/lib/services/workspace-export.service";

export const runtime = "nodejs";
export const maxDuration = 60;
export const GET = route<{ workspaceId: string }>(async (request, params) => {
  const context = await requireWorkspace(request, idSchema.parse(params.workspaceId));
  return new Response(await exportWorkspace(context), { headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": `attachment; filename="scopeflow-${context.workspaceId}.json"`,
    "Cache-Control": "private, no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
  } });
});
