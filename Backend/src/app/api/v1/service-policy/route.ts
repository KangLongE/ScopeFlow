import { credits } from "@/lib/ai/usage-policy";
import { json, route } from "@/lib/http";

export const GET = route(async () => json({
  version: "2026-11-17-draft", billingEnabled: false,
  operator: { name: "강태현", email: "scopeflowservice@gmail.com" },
  credits,
  limits: "WORKSPACE_AND_USER_SETTINGS",
  charging: { confirmedFailure: 0, cachedReuse: 0, pending: "RESERVED", unknown: "CHECK_EXISTING_EXECUTION", successfulDraft: "CHARGED_ONCE" },
}));
