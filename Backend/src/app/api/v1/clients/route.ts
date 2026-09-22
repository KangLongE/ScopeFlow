import { requireWorkspace } from "@/lib/auth/session";
import { json, parseBody, route } from "@/lib/http";
import { clientService } from "@/lib/services/core.service";
import { clientCreateSchema } from "@/lib/validation";

export const GET = route(async (request) => json(await clientService.list(await requireWorkspace(request))));
export const POST = route(async (request) => { const context = await requireWorkspace(request); return json(await clientService.create(context, await parseBody(request, clientCreateSchema)), 201); });

