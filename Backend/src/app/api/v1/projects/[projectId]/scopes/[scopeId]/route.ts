import { z } from "zod";
import { requireWorkspace } from "@/lib/auth/session";
import { idSchema } from "@/lib/model";
import { json, parseBody, route } from "@/lib/http";
import { scopeService } from "@/lib/services/workflow.service";

type P = { projectId: string; scopeId: string };
const schema = z.object({ document: z.record(z.string(), z.unknown()).optional(), requirementIds: z.array(idSchema).max(100).optional() }).refine((value) => Object.keys(value).length > 0);
export const GET = route<P>(async (request, params) => json(await scopeService.get(await requireWorkspace(request), idSchema.parse(params.projectId), idSchema.parse(params.scopeId))));
export const PATCH = route<P>(async (request, params) => json(await scopeService.update(await requireWorkspace(request), idSchema.parse(params.projectId), idSchema.parse(params.scopeId), await parseBody(request, schema))));

