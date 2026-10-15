import { requireWorkspace } from "@/lib/auth/session";
import { z } from "zod";
import { idSchema } from "@/lib/model";
import { json, parseBody, route } from "@/lib/http";
import { changeRequestService } from "@/lib/services/workflow.service";

type P = { projectId: string; id: string };
export const POST = route<P>(async (request, params) => json(await changeRequestService.internalApprove(await requireWorkspace(request), idSchema.parse(params.projectId), idSchema.parse(params.id), (await parseBody(request, z.object({ candidateRevision: z.number().int().min(0) }))).candidateRevision)));
