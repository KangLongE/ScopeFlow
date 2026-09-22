import { z } from "zod";
import { idSchema, textSchema, titleSchema } from "@/lib/model";
import { json, parseBody, route } from "@/lib/http";
import { clientAccessService } from "@/lib/services/workflow.service";

type P = { token: string; questionId: string };
const schema = z.object({ content: textSchema, author: titleSchema });
export const POST = route<P>(async (request, params) => { const body = await parseBody(request, schema); return json(await clientAccessService.answer(params.token, idSchema.parse(params.questionId), body.content, body.author)); });

