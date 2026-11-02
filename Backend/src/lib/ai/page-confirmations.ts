import { z } from "zod";
import { fingerprint } from "@/lib/fingerprint";

export const pageConfirmationSchema = z.object({ key: z.string(), basisFingerprint: z.string(), reason: z.string().min(1), actor: z.string().min(1), confirmedAt: z.string(), ruleSetVersion: z.string() });
export type PageConfirmation = z.infer<typeof pageConfirmationSchema>;
export type PageCheck = Pick<PageConfirmation, "key" | "basisFingerprint">;
export function pageCheck(title: unknown, description: unknown, implementation: unknown, facts: unknown[], ruleSetVersion: string): PageCheck {
  const normalize = (value: unknown) => typeof value === "string" ? value.trim().replace(/\s+/g, " ") : value;
  const attrs = implementation && typeof implementation === "object" ? implementation as { pageCount?: unknown; separatePage?: unknown } : {};
  return { key: fingerprint(normalize(title)), basisFingerprint: fingerprint({ title: normalize(title), description: normalize(description), pageCount: attrs.pageCount, separatePage: attrs.separatePage, facts, ruleSetVersion }) };
}
