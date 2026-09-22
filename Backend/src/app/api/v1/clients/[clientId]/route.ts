import { requireWorkspace } from "@/lib/auth/session";
import { idSchema } from "@/lib/model";
import { json, parseBody, route } from "@/lib/http";
import { clientService } from "@/lib/services/core.service";
import { clientUpdateSchema } from "@/lib/validation";

type P = { clientId: string };
export const GET = route<P>(async (request, params) => json(await clientService.get(await requireWorkspace(request), idSchema.parse(params.clientId))));
export const PATCH = route<P>(async (request, params) => json(await clientService.update(await requireWorkspace(request), idSchema.parse(params.clientId), await parseBody(request, clientUpdateSchema))));
export const DELETE = route<P>(async (request, params) => { await clientService.remove(await requireWorkspace(request), idSchema.parse(params.clientId)); return new Response(null, { status: 204 }); });

