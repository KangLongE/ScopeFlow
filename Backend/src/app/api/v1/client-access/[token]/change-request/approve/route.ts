import { z } from "zod";
import { titleSchema } from "@/lib/model";
import { json, parseBody, route } from "@/lib/http";
import { clientAccessService } from "@/lib/services/workflow.service";

type P = { token: string };
const schema = z.object({ name: titleSchema, consent: z.literal(true) });
export const POST = route<P>(async (request, params) => { const body = await parseBody(request, schema); return json(await clientAccessService.decide(params.token, "APPROVE", body.name, "")); });

