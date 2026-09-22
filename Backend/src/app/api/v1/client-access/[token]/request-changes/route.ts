import { z } from "zod";
import { textSchema, titleSchema } from "@/lib/model";
import { json, parseBody, route } from "@/lib/http";
import { clientAccessService } from "@/lib/services/workflow.service";

type P = { token: string };
const schema = z.object({ name: titleSchema, message: textSchema, decision: z.enum(["REVISE", "REJECT"]).default("REVISE") });
export const POST = route<P>(async (request, params) => { const body = await parseBody(request, schema); return json(await clientAccessService.decide(params.token, body.decision, body.name, body.message)); });

