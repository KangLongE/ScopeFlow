import { z } from "zod";
import { requireWorkspace } from "@/lib/auth/session";
import { idSchema } from "@/lib/model";
import { json, parseBody, route } from "@/lib/http";
import { scopeService } from "@/lib/services/workflow.service";
import { exclusionEditSchema } from "@/lib/scope-exclusions";

type P = { projectId: string };
const schema = z.object({ exclusions: exclusionEditSchema.optional(), document: z.record(z.string(), z.unknown()).optional(), requirementIds: z.array(idSchema).max(100).optional() });
export const GET = route<P>(async (request, params) => json(await scopeService.list(await requireWorkspace(request), idSchema.parse(params.projectId))));
export const POST = route<P>(async (request, params) => json(await scopeService.create(await requireWorkspace(request), idSchema.parse(params.projectId), await parseBody(request, schema)), 201));

