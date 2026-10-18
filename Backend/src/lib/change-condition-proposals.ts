import { comparisonSchema, type conditionSchema } from "./model";
import type { z } from "zod";
import type { ProjectAIContext } from "./services/ai-context.service";
import { fingerprint } from "./fingerprint";
import { exclusionKind, sameExclusion } from "./scope-exclusions";

const mentions: Record<string, RegExp> = { EXTERNAL_INTEGRATION: /외부\s*(?:서비스\s*)?연동|external integration/i, ADMIN: /관리자|admin/i, PAYMENT: /결제|payment/i, SIGNUP: /회원\s*가입|signup/i, SERVER: /별도\s*서버|서버\s*(?:구현|API)|server|API/i };
export function changeConditionProposals(context: ProjectAIContext, value: unknown): z.infer<typeof conditionSchema>[] {
  const parsed = comparisonSchema.safeParse(value);
  if (!parsed.success || !context.changeRequest || !context.approvedBaseline?.isCurrent || !["OUT_OF_SCOPE", "PARTIALLY_IN_SCOPE"].includes(parsed.data.classification)) return [];
  const c = parsed.data; const ref = `change:${context.changeRequest.id}`;
  const source = context.sources.find(s => s.id === ref && s.kind === "CHANGE_REQUEST");
  if (!source || source.text !== context.changeRequest.request || !c.reason.trim() || !c.reviewNotes?.sourceRefs.includes(ref)) return [];
  const excluded = (context.approvedBaseline.document as { excluded?: string[] }).excluded ?? [];
  return c.removedExclusions.flatMap(title => {
    const kind = exclusionKind(title); const pattern = kind ? mentions[kind] : undefined;
    if (!kind || !pattern || !excluded.includes(title) || !c.newRequirements.some(r => r.sourceRefs.includes(ref) && (kind === "SERVER" ? r.implementation?.serverWork === "SERVER_API" : r.implementation?.featureTypes.some(type => type === kind)))) return [];
    const evidence = source.text.split(/[\n.!?。;]/).find(line => pattern.test(line) && /추가|구현|개발|포함|해제|철회|add|implement|include/i.test(line) && (!/제외|excluded/i.test(line) || /(?:제외|excluded).{0,20}(?:해제|철회|remove)/i.test(line)) && !/하지\s*않|하지\s*말|미포함|유지|보류|논의|추후|할까요|해제\s*안/.test(line));
    if (!evidence) return [];
    const ids = [...context.confirmedExcludedScope.filter(e => sameExclusion(e.title, title)).map(e => e.id), `excluded:${fingerprint(title).slice(0, 16)}`, ...context.explicitCustomerConstraints.filter(f => f.active && exclusionKind(f.key) === kind && (f.value === false || f.value === "excluded")).map(f => f.id)];
    return [{ id: `change-condition:${fingerprint([context.changeRequest!.id, title, source.revision]).slice(0, 24)}`, key: kind, value: "included", status: "explicit" as const, evidence, sourceRefs: [ref], supersedes: [...new Set(ids)] }];
  });
}
export function withChangeConditionProposals(context: ProjectAIContext, value: unknown): unknown {
  const proposals = changeConditionProposals(context, value);
  if (!proposals.length) return value;
  const c = value as z.infer<typeof comparisonSchema>;
  return { ...c, reviewNotes: { ...c.reviewNotes, constraints: [...(c.reviewNotes?.constraints ?? []).filter(n => !proposals.some(p => p.id === n.id)), ...proposals] } };
}
