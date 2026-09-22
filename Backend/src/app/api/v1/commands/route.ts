import { z } from "zod";
import { requireUser, requireWorkspace } from "@/lib/auth/session";
import { json, parseBody, route } from "@/lib/http";
import { commandSchema, createWorkspace, executeCommand } from "@/lib/services/command.service";

export const POST = route(async (request) => {
  const command = commandSchema.parse(await parseBody(request, z.record(z.string(), z.unknown())));
  if (command.action === "workspace.create") return json(await createWorkspace((await requireUser(request)).user.id, command.name));
  if (command.action === "workspace.switch") {
    await requireWorkspace(request, command.workspaceId);
    return json({ message: "Workspace를 전환했습니다.", redirect: "/dashboard", workspaceId: command.workspaceId });
  }
  return json(await executeCommand(await requireWorkspace(request), command));
});
