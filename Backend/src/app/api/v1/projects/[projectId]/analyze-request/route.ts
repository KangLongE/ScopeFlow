import { z } from "zod";
import { requireWorkspace } from "@/lib/auth/session";
import { idSchema, textSchema } from "@/lib/model";
import { json, parseBody, route } from "@/lib/http";
import { aiWorkflowService } from "@/lib/services/ai-workflow.service";

type P = { projectId: string };
const schema = z.object({ text: textSchema, regenerate: z.boolean().default(false) });
export const POST = route<P>(async (request, params) => { const body = await parseBody(request, schema); return json(await aiWorkflowService.analyzeRequest(await requireWorkspace(request), idSchema.parse(params.projectId), body.text, body.regenerate)); });

