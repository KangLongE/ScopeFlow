import { requireWorkspace } from "@/lib/auth/session";
import { idSchema } from "@/lib/model";
import { json, parseBody, route } from "@/lib/http";
import { projectService } from "@/lib/services/core.service";
import { projectUpdateSchema } from "@/lib/validation";

type P = { projectId: string };
export const GET = route<P>(async (request, params) => json(await projectService.get(await requireWorkspace(request), idSchema.parse(params.projectId))));
export const PATCH = route<P>(async (request, params) => json(await projectService.update(await requireWorkspace(request), idSchema.parse(params.projectId), await parseBody(request, projectUpdateSchema))));
export const DELETE = route<P>(async (request, params) => { await projectService.remove(await requireWorkspace(request), idSchema.parse(params.projectId)); return new Response(null, { status: 204 }); });

