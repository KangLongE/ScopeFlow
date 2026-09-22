import { z } from "zod";
import { requireWorkspace } from "@/lib/auth/session";
import { idSchema } from "@/lib/model";
import { json, parseBody, route } from "@/lib/http";
import { clientAccessService } from "@/lib/services/workflow.service";

type P = { projectId: string };
const schema = z.object({ purpose: z.enum(["QUESTIONS", "SCOPE", "CHANGE"]), targetId: idSchema.optional() }).superRefine((value, context) => { if (value.purpose !== "QUESTIONS" && !value.targetId) context.addIssue({ code: "custom", message: "targetId가 필요합니다." }); });
export const POST = route<P>(async (request, params) => { const body = await parseBody(request, schema); return json(await clientAccessService.create(await requireWorkspace(request), idSchema.parse(params.projectId), body.purpose, body.targetId), 201); });

