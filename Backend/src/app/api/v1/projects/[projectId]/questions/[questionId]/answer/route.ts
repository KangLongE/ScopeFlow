import { requireWorkspace } from "@/lib/auth/session";
import { idSchema } from "@/lib/model";
import { json, parseBody, route } from "@/lib/http";
import { questionService } from "@/lib/services/core.service";
import { answerSchema } from "@/lib/validation";

type P = { projectId: string; questionId: string };
export const POST = route<P>(async (request, params) => { const body = await parseBody(request, answerSchema); return json(await questionService.answer(await requireWorkspace(request), idSchema.parse(params.projectId), idSchema.parse(params.questionId), body.content, body.author)); });

