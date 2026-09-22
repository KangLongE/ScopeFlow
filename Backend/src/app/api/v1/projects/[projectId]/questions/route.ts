import { requireWorkspace } from "@/lib/auth/session";
import { idSchema } from "@/lib/model";
import { json, route } from "@/lib/http";
import { questionService } from "@/lib/services/core.service";

type P = { projectId: string };
export const GET = route<P>(async (request, params) => json(await questionService.list(await requireWorkspace(request), idSchema.parse(params.projectId))));

