import { requireUser } from "@/lib/auth/session";
import { json, parseBody, route } from "@/lib/http";
import { workspaceService } from "@/lib/services/workspace.service";
import { workspaceCreateSchema } from "@/lib/validation";

export const GET = route(async (request) => json(await workspaceService.list((await requireUser(request)).user.id)));
export const POST = route(async (request) => { const session = await requireUser(request); const body = await parseBody(request, workspaceCreateSchema); return json(await workspaceService.create(session.user.id, body.name), 201); });

