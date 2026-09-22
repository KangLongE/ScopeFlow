import { z } from "zod";
import { requireWorkspace } from "@/lib/auth/session";
import { idSchema } from "@/lib/model";
import { json, parseBody, route } from "@/lib/http";
import { aiWorkflowService } from "@/lib/services/ai-workflow.service";

type P = { projectId: string };
export const POST = route<P>(async (request, params) => { const body = await parseBody(request, z.object({ regenerate: z.boolean().default(false) })); return json(await aiWorkflowService.generateQuestions(await requireWorkspace(request), idSchema.parse(params.projectId), body.regenerate), 201); });

