import { z } from "zod";
import { requireWorkspace } from "@/lib/auth/session";
import { idSchema, textSchema } from "@/lib/model";
import { json, parseBody, route } from "@/lib/http";
import { changeRequestService } from "@/lib/services/workflow.service";

type P = { projectId: string };
export const GET = route<P>(async (request, params) => json(await changeRequestService.list(await requireWorkspace(request), idSchema.parse(params.projectId))));
export const POST = route<P>(async (request, params) => { const body = await parseBody(request, z.object({ request: textSchema })); return json(await changeRequestService.create(await requireWorkspace(request), idSchema.parse(params.projectId), body.request), 201); });

