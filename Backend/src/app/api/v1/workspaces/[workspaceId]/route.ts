import { requireWorkspace } from "@/lib/auth/session";
import { idSchema } from "@/lib/model";
import { json, parseBody, route } from "@/lib/http";
import { workspaceService } from "@/lib/services/workspace.service";
import { workspaceUpdateSchema } from "@/lib/validation";

type P = { workspaceId: string };
export const GET = route<P>(async (request, params) => json(await workspaceService.get(await requireWorkspace(request, idSchema.parse(params.workspaceId)))));
export const PATCH = route<P>(async (request, params) => { const context = await requireWorkspace(request, idSchema.parse(params.workspaceId)); const body = await parseBody(request, workspaceUpdateSchema); return json(await workspaceService.update(context, body.name)); });

