import { requireWorkspace } from "@/lib/auth/session";
import { json, route } from "@/lib/http";
import { aiUsageService } from "@/lib/ai/ai.service";
import { aiExecutionSchema } from "@/lib/ai/usage-policy";
import { idSchema } from "@/lib/model";
import { z } from "zod";
import { AIAction } from "@/generated/prisma/client";

export const GET = route(async (request) => {
  const context = await requireWorkspace(request);
  const executionKey = new URL(request.url).searchParams.get("executionKey");
  const params = new URL(request.url).searchParams;
  if (params.has("operation")) return json(await aiUsageService.preview(context, idSchema.parse(params.get("projectId")), z.enum(AIAction).parse(params.get("operation")), params.get("regenerate") === "true", params.has("changeId") ? idSchema.parse(params.get("changeId")) : undefined));
  return json(executionKey ? await aiUsageService.execution(context, aiExecutionSchema.shape.executionKey.parse(executionKey)) : await aiUsageService.current(context));
});

