import { requireWorkspace } from "@/lib/auth/session";
import { json, route } from "@/lib/http";
import { aiUsageService } from "@/lib/ai/ai.service";

export const GET = route(async (request) => json(await aiUsageService.current(await requireWorkspace(request))));

