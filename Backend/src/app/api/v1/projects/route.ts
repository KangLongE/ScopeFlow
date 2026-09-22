import { requireWorkspace } from "@/lib/auth/session";
import { json, parseBody, route } from "@/lib/http";
import { projectService } from "@/lib/services/core.service";
import { projectCreateSchema } from "@/lib/validation";

export const GET = route(async (request) => json(await projectService.list(await requireWorkspace(request))));
export const POST = route(async (request) => { const context = await requireWorkspace(request); return json(await projectService.create(context, await parseBody(request, projectCreateSchema)), 201); });

