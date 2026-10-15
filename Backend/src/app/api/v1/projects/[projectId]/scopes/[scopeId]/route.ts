import { z } from "zod";
import { requireWorkspace } from "@/lib/auth/session";
import { idSchema } from "@/lib/model";
import { json, parseBody, route } from "@/lib/http";
import { scopeService } from "@/lib/services/workflow.service";
import { warningInputSchema } from "@/lib/ai/rule-validator";
import { exclusionEditSchema } from "@/lib/scope-exclusions";

type P = { projectId: string; scopeId: string };
const schema = z.object({ exclusions: exclusionEditSchema.optional(), candidateRevision: z.number().int().min(0), reason: z.string().trim().max(5000).optional(), warnings: z.array(warningInputSchema).max(100).optional(), document: z.record(z.string(), z.unknown()).optional(), requirementIds: z.array(idSchema).max(100).optional() }).refine((value) => value.exclusions !== undefined || value.document !== undefined || value.requirementIds !== undefined || value.warnings !== undefined);
export const GET = route<P>(async (request, params) => json(await scopeService.get(await requireWorkspace(request), idSchema.parse(params.projectId), idSchema.parse(params.scopeId))));
export const PATCH = route<P>(async (request, params) => json(await scopeService.update(await requireWorkspace(request), idSchema.parse(params.projectId), idSchema.parse(params.scopeId), await parseBody(request, schema))));
