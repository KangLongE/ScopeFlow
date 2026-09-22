import { requireWorkspace } from "@/lib/auth/session";
import { json, parseBody, route } from "@/lib/http";
import { rateCardService } from "@/lib/services/core.service";
import { rateCardSchema } from "@/lib/validation";

export const GET = route(async (request) => json(await rateCardService.get(await requireWorkspace(request))));
export const PATCH = route(async (request) => { const context = await requireWorkspace(request); return json(await rateCardService.update(context, (await parseBody(request, rateCardSchema)).rates)); });

