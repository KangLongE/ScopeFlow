import { requireWorkspace } from "@/lib/auth/session";
import { idSchema } from "@/lib/model";
import { json, parseBody, route } from "@/lib/http";
import { requirementService } from "@/lib/services/core.service";
import { requirementUpdateSchema } from "@/lib/validation";

type P = { projectId: string; requirementId: string };
export const PATCH = route<P>(async (request, params) => json(await requirementService.update(await requireWorkspace(request), idSchema.parse(params.projectId), idSchema.parse(params.requirementId), await parseBody(request, requirementUpdateSchema))));
export const DELETE = route<P>(async (request, params) => { await requirementService.remove(await requireWorkspace(request), idSchema.parse(params.projectId), idSchema.parse(params.requirementId)); return new Response(null, { status: 204 }); });

