import { requireWorkspace } from "@/lib/auth/session";
import { idSchema } from "@/lib/model";
import { json, parseBody, route } from "@/lib/http";
import { requirementService } from "@/lib/services/core.service";
import { requirementCreateSchema } from "@/lib/validation";

type P = { projectId: string };
export const GET = route<P>(async (request, params) => json(await requirementService.list(await requireWorkspace(request), idSchema.parse(params.projectId))));
export const POST = route<P>(async (request, params) => json(await requirementService.create(await requireWorkspace(request), idSchema.parse(params.projectId), await parseBody(request, requirementCreateSchema)), 201));

