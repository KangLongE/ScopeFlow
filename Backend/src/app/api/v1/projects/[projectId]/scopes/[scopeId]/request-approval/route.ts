import { requireWorkspace } from "@/lib/auth/session";
import { idSchema } from "@/lib/model";
import { json, route } from "@/lib/http";
import { scopeService } from "@/lib/services/workflow.service";

type P = { projectId: string; scopeId: string };
export const POST = route<P>(async (request, params) => json(await scopeService.requestApproval(await requireWorkspace(request), idSchema.parse(params.projectId), idSchema.parse(params.scopeId))));

