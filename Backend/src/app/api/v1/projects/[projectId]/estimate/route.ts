import { z } from "zod";
import { requireWorkspace } from "@/lib/auth/session";
import { hoursSchema, idSchema, moneySchema, textSchema } from "@/lib/model";
import { json, parseBody, route } from "@/lib/http";
import { aiWorkflowService } from "@/lib/services/ai-workflow.service";
import { warningInputSchema } from "@/lib/ai/rule-validator";

type P = { projectId: string };
const updateSchema = z.object({ candidateRevision: z.number().int().min(0), warnings: z.array(warningInputSchema).max(100).optional(), items: z.array(z.object({ requirementId: idSchema, hours: hoursSchema, complexity: z.enum(["LOW", "MEDIUM", "HIGH"]), reason: textSchema, reviewed: z.boolean().optional() })).optional(), overrideTotal: moneySchema.nullable().optional(), adjustmentReason: z.string().trim().max(5000).optional() }).refine((value) => value.items !== undefined || value.overrideTotal !== undefined || value.adjustmentReason !== undefined || value.warnings !== undefined);
export const GET = route<P>(async (request, params) => json(await aiWorkflowService.getEstimate(await requireWorkspace(request), idSchema.parse(params.projectId))));
export const PATCH = route<P>(async (request, params) => json(await aiWorkflowService.updateEstimate(await requireWorkspace(request), idSchema.parse(params.projectId), await parseBody(request, updateSchema))));
