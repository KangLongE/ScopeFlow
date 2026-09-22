import { requireWorkspace } from "@/lib/auth/session";
import { idSchema } from "@/lib/model";
import { json, route } from "@/lib/http";
import { changeRequestService } from "@/lib/services/workflow.service";

type P = { projectId: string; id: string };
export const POST = route<P>(async (request, params) => json(await changeRequestService.internalApprove(await requireWorkspace(request), idSchema.parse(params.projectId), idSchema.parse(params.id))));

