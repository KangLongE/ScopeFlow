import { z } from "zod";
import { fingerprint } from "./fingerprint";
import { ApiError } from "./errors";

type Source = { id: string; kind: string; label: string; text: string; revision: string };
const text = z.string().trim().min(1).max(5000);
const evidenceSchema = z.object({ sourceRef: z.string(), revision: z.string(), quote: z.string().min(1).max(10_000) });
export const exclusionItemSchema = z.object({
  id: z.string().min(1).max(200), title: text.max(160), description: text.nullable(),
  origin: z.enum(["customer_request", "customer_answer", "staff", "template", "ai_assumption"]),
  sourceRefs: z.array(z.string().max(200)).max(80),
  evidence: z.array(evidenceSchema).max(80),
  extractionRunIds: z.array(z.string().uuid()).max(80).default([]),
  explicit: z.boolean(), state: z.enum(["pending", "active", "superseded", "dismissed"]),
  resolutionReason: text.nullable(), resolutionSourceRefs: z.array(z.string().max(200)).max(80).default([]),
  resolutionEvidence: z.array(evidenceSchema).max(80).default([]),
  duplicateOf: z.string().max(200).nullable().default(null), reviewedBy: z.string().nullable(), reviewedAt: z.string().nullable(),
});
export type ExclusionItem = z.infer<typeof exclusionItemSchema>;
export const exclusionReviewSchema = z.object({ revision: z.number().int().min(0), contextFingerprint: z.string(), items: z.array(exclusionItemSchema).max(100) });
export type ExclusionReview = z.infer<typeof exclusionReviewSchema>;
export const exclusionEditSchema = exclusionReviewSchema;
export const readExclusionReview = (value: unknown) => exclusionReviewSchema.nullable().catch(null).parse(value ?? null);
const compact = (value: string) => value.toLowerCase().replace(/[\s_.·-]/g, "");
const groups = {
  PAYMENT: { pattern: /결제(?:\s*기능)?|payment/gi, title: "결제 기능 구현 제외" },
  SIGNUP: { pattern: /회원\s*가입(?:\s*기능)?|signup|user registration/gi, title: "회원가입 기능 구현 제외" },
  ADMIN: { pattern: /관리자(?:\s*(?:페이지|화면|기능))?|admin(?: page| panel)?/gi, title: "관리자 페이지 개발 제외" },
  EXTERNAL_INTEGRATION: { pattern: /외부\s*(?:서비스\s*|프로젝트\s*관리\s*도구\s*)?연동|external integrations?/gi, title: "외부 서비스 연동 개발 제외" },
  SERVER: { pattern: /별도\s*서버(?:\s*구현)?|서버\s*구현|separate server(?: implementation)?/gi, title: "별도 서버 구현 제외" },
  MAINTENANCE: { pattern: /유지\s*보수|maintenance/gi, title: "유지보수 범위 확인 필요" },
} as const;
export function exclusionKind(title: string): string | null {
  if (/수수료|이용료|비용\s*부담|사용료/.test(title)) return null;
  const value = compact(title).replace(/(?:기능|개발|구현|이번범위|제외|미포함|은|는|의|을|를)/g, "");
  const names: Record<string, string[]> = { PAYMENT: ["결제", "온라인결제", "payment", "paymentprocessing"], SIGNUP: ["회원가입", "signup", "userregistration"], ADMIN: ["관리자", "관리자페이지", "관리자화면", "admin", "adminpage", "adminpanel"], EXTERNAL_INTEGRATION: ["외부연동", "외부서비스연동", "외부프로젝트관리도구연동", "externalintegration", "externalintegrations"], SERVER: ["별도서버", "서버", "separateserverimplementation", "serverimplementation", "separateserver"] };
  return Object.entries(names).find(([, aliases]) => aliases.includes(value))?.[0] ?? null;
}
export const sameExclusion = (a: string, b: string) => compact(a) === compact(b) || !!exclusionKind(a) && exclusionKind(a) === exclusionKind(b);
const itemId = (title: string) => "excluded:" + fingerprint(title).slice(0, 16);
const evidenceFingerprint = (item: ExclusionItem) => fingerprint({ evidence: item.evidence, explicit: item.explicit });
function item(title: string, origin: ExclusionItem["origin"], evidence: ExclusionItem["evidence"] = [], explicit = false): ExclusionItem {
  return { id: itemId(title), title, description: null, origin, sourceRefs: [...new Set(evidence.map(e => e.sourceRef))], evidence, extractionRunIds: [], explicit, state: "pending", resolutionReason: null, resolutionSourceRefs: [], resolutionEvidence: [], duplicateOf: null, reviewedBy: null, reviewedAt: null };
}
function disposition(tail: string) {
  if (/제외\s*하지\s*않|제외\s*아[님니]|not excluded|do not exclude/i.test(tail)) return null;
  if (/나중|추후|논의|미정|확인\s*필요|보류/.test(tail)) return "pending";
  return /제외|미포함|불필요|필요\s*(?:가\s*)?없|excluded|not needed/i.test(tail) || /^\s*(?:은|는|이|가|도|[:/=-])?\s*없(?:음|습니다|어요|다)/.test(tail) ? "explicit" : null;
}

/** Bounded literal suggestions, not a general semantic classifier; unknown wording stays with the existing AI/Q&A review. */
export function extractExclusions(sources: Source[]): ExclusionItem[] {
  const result: ExclusionItem[] = [];
  for (const source of sources.filter(s => ["REQUEST", "ANSWER"].includes(s.kind))) {
    const content = source.kind === "ANSWER" ? source.text.slice(source.text.indexOf("\n") + 1) : source.text;
    for (const sentence of content.split(/[\n.!?]/).map(s => s.trim()).filter(Boolean)) {
      const matches = Object.entries(groups).flatMap(([kind, rule]) => [...sentence.matchAll(rule.pattern)].map(m => ({ kind, title: rule.title, start: m.index, end: m.index + m[0].length }))).sort((a, b) => a.start - b.start);
      let inherited: "explicit" | "pending" | null = null;
      for (let i = matches.length - 1; i >= 0; i--) {
        const match = matches[i]; const tail = sentence.slice(match.end, matches[i + 1]?.start);
        const own = disposition(tail);
        const conjunction = /^[\s,·/와과및은는기능개발구현그리고또한]*$/.test(tail);
        const state: "explicit" | "pending" | null = own ?? (conjunction ? inherited : null);
        inherited = state;
        if (!state || /수수료|이용료|사용료/.test(tail)) continue;
        result.push(item(match.title, source.kind === "ANSWER" ? "customer_answer" : "customer_request", [{ sourceRef: source.id, revision: source.revision, quote: sentence }], state === "explicit" && match.kind !== "MAINTENANCE"));
      }
    }
  }
  return result;
}

export function prepareExclusions(sources: Source[], notes: { title: string; status?: string; evidence?: string; sourceRefs: string[]; extractionRunId?: string }[], previous: ExclusionReview | null, legacy: string[] = [], extra: string[] = []): ExclusionReview {
  const proposals = extractExclusions(sources);
  for (const note of notes) {
    const evidence = note.sourceRefs.flatMap(ref => { const source = sources.find(s => s.id === ref); return source && note.evidence && source.text.includes(note.evidence) ? [{ sourceRef: ref, revision: source.revision, quote: note.evidence }] : []; });
    const customer = evidence.length && evidence.every(e => ["REQUEST", "ANSWER"].includes(sources.find(s => s.id === e.sourceRef)!.kind));
    const staff = evidence.length && evidence.every(e => sources.find(s => s.id === e.sourceRef)?.kind === "EXCLUDED_REQUIREMENT");
    const origin = customer ? sources.find(s => s.id === evidence[0].sourceRef)?.kind === "ANSWER" ? "customer_answer" : "customer_request" : staff ? "staff" : "ai_assumption";
    const literal = proposals.find(p => sameExclusion(p.title, note.title));
    proposals.push({ ...item(note.title, origin, evidence, !!customer && note.status === "explicit" && !!literal?.explicit), extractionRunIds: note.extractionRunId ? [note.extractionRunId] : [] });
  }
  for (const title of legacy) if (!previous?.items.some(p => p.title === title)) proposals.push(item(title, "staff"));
  for (const title of extra) if (!proposals.some(p => sameExclusion(p.title, title)) && !previous?.items.some(p => sameExclusion(p.title, title))) proposals.push(item(title, "ai_assumption"));
  const merged: ExclusionItem[] = [];
  for (const proposal of proposals) {
    const old = merged.find(p => sameExclusion(p.title, proposal.title));
    if (old) { old.evidence = [...new Map([...old.evidence, ...proposal.evidence].map(e => [fingerprint(e), e])).values()]; old.sourceRefs = [...new Set([...old.sourceRefs, ...proposal.sourceRefs])]; old.extractionRunIds = [...new Set([...old.extractionRunIds, ...proposal.extractionRunIds])]; old.explicit ||= proposal.explicit; }
    else merged.push(proposal);
  }
  const items = merged.map(p => {
    const matches = previous?.items.filter(o => o.id === p.id || sameExclusion(o.title, p.title)) ?? [];
    const old = matches.find(o => o.state === "active") ?? matches.find(o => o.state === "pending") ?? matches[0];
    const resolutionValid = old?.reviewedBy === "customer-approved-change" || (old?.resolutionEvidence ?? []).every(e => sources.some(s => s.id === e.sourceRef && s.revision === e.revision));
    return old && resolutionValid && evidenceFingerprint(old) === evidenceFingerprint(p) ? { ...old, evidence: p.evidence, sourceRefs: p.sourceRefs, extractionRunIds: [...new Set([...old.extractionRunIds, ...p.extractionRunIds])], explicit: p.explicit } : { ...p, id: old?.id ?? p.id };
  });
  for (const old of previous?.items ?? []) if (!items.some(p => p.id === old.id)) {
    const stillValid = old.evidence.every(e => sources.some(s => s.id === e.sourceRef && s.revision === e.revision && s.text.includes(e.quote)));
    items.push(stillValid ? old : { ...old, state: "pending", reviewedBy: null, reviewedAt: null });
  }
  const inputSources = sources.filter(s => s.kind !== "SCOPE_DRAFT");
  return { revision: previous?.revision ?? 0, contextFingerprint: fingerprint(inputSources), items };
}
export function editExclusions(current: ExclusionReview, value: unknown, sources: Source[], actor: string): ExclusionReview {
  const input = exclusionEditSchema.parse(value);
  if (input.revision !== current.revision || input.contextFingerprint !== current.contextFingerprint) throw new ApiError("EXCLUSIONS_CHANGED", "검토 중 원문·답변·포함 범위 또는 제외 목록이 변경되었습니다. 입력을 보존하고 최신 목록을 다시 확인해주세요.", 409);
  if (new Set(input.items.map(i => i.id)).size !== input.items.length) throw new ApiError("EXCLUSION_DUPLICATE_ID", "같은 제외 항목이 중복되었습니다.", 422);
  const now = new Date().toISOString();
  const items = input.items.map((edit, index) => {
    const old = current.items.find(i => i.id === edit.id);
    const fail = (message: string): never => { throw new ApiError("INVALID_EXCLUSION", message, 422, { fieldErrors: [{ fieldPath: `exclusions.items.${index}`, message }] }); };
    if (edit.sourceRefs.some(ref => !sources.some(s => s.id === ref)) || edit.resolutionSourceRefs.some(ref => !sources.some(s => s.id === ref))) fail("이 프로젝트에서 확인할 수 없는 제외 조건 출처입니다.");
    if (!old) {
      if (!["staff", "template"].includes(edit.origin) || edit.sourceRefs.length || edit.evidence.length || edit.extractionRunIds.length || edit.explicit) fail("직접 추가한 조건을 고객 발언이나 확인된 출처로 표시할 수 없습니다.");
      if (!["pending", "active"].includes(edit.state)) fail("새 조건은 검토 필요 또는 담당자 확인 상태로 추가해주세요.");
      return { ...edit, reviewedBy: actor, reviewedAt: now };
    }
    if (edit.origin !== old.origin || fingerprint(edit.sourceRefs) !== fingerprint(old.sourceRefs) || fingerprint(edit.evidence) !== fingerprint(old.evidence) || fingerprint(edit.extractionRunIds) !== fingerprint(old.extractionRunIds) || edit.explicit !== old.explicit) fail("출처와 원문 근거는 변경할 수 없습니다. 조건 변경 사유와 후속 답변을 연결해주세요.");
    const changed = fingerprint([edit.title, edit.description, edit.state, edit.resolutionReason, edit.resolutionSourceRefs, edit.duplicateOf]) !== fingerprint([old.title, old.description, old.state, old.resolutionReason, old.resolutionSourceRefs, old.duplicateOf]);
    if (!old.explicit && old.origin !== "staff" && old.evidence.length && edit.state === "active" && !edit.resolutionReason?.trim()) fail("모호한 제외 제안은 담당자의 판단 사유를 입력한 뒤 확인해주세요.");
    if (changed && (old.state === "active" || ["dismissed", "superseded"].includes(edit.state)) && !edit.resolutionReason?.trim()) fail("제외 조건의 수정·해제 사유를 입력해주세요.");
    if (old.explicit && edit.state === "active" && !sameExclusion(edit.title, old.title)) fail("고객 명시 조건의 의미가 달라졌습니다. 문구 수정으로 처리할 수 없습니다. 후속 고객 답변으로 조건 변경을 검토해주세요.");
    if (edit.state === "dismissed") {
      const duplicate = input.items.find(i => i.id === edit.duplicateOf && (i.state === "active" || !changed && i.state === "pending") && sameExclusion(i.title, old.title));
      if (edit.duplicateOf && !duplicate) fail("중복 대상은 같은 의미의 실제 유지 항목이어야 합니다. 관련 없는 조건을 합칠 수 없습니다.");
      if (old.explicit && !duplicate) fail("고객의 실제 명시 제외 조건은 삭제만으로 해제할 수 없습니다. 중복 대상이나 후속 조건 변경 근거가 필요합니다.");
    }
    if (edit.state === "superseded" && changed) {
      const kind = exclusionKind(old.title);
      const later = edit.resolutionSourceRefs.some(ref => { const source = sources.find(s => s.id === ref); if (!source || !["REQUEST", "ANSWER"].includes(source.kind)) return false; const content = source.kind === "ANSWER" ? source.text.slice(source.text.indexOf("\n") + 1) : source.text; const rule = kind ? groups[kind as keyof typeof groups] : null; return rule && new RegExp(rule.pattern.source, "i").test(content) && /추가|포함|개발|구현/.test(content) && !/제외\s*하지\s*않|(?:추가|포함|개발|구현)\s*하지\s*않/.test(content) && !extractExclusions([source]).some(p => sameExclusion(p.title, old.title) && p.explicit); });
      if (!later || !edit.resolutionReason) fail("조건 해제는 실제 후속 고객 요청·저장 답변과 담당자 사유가 필요합니다. 담당자 검토는 고객 승인과 별개입니다.");
    }
    return changed ? { ...old, ...edit, resolutionEvidence: edit.state === "superseded" ? edit.resolutionSourceRefs.map(ref => { const s = sources.find(s => s.id === ref)!; return { sourceRef: ref, revision: s.revision, quote: s.text.slice(0, 5000) }; }) : [], reviewedBy: actor, reviewedAt: now } : old;
  });
  if (current.items.some(old => !items.some(i => i.id === old.id))) throw new ApiError("EXCLUSION_REMOVED", "후보를 조용히 삭제할 수 없습니다. 해제 상태와 사유를 남겨주세요.", 422);
  for (const duplicate of items.filter(i => i.state === "dismissed" && i.duplicateOf)) {
    const target = items.find(i => i.id === duplicate.duplicateOf)!;
    target.evidence = [...new Map([...target.evidence, ...duplicate.evidence].map(e => [fingerprint(e), e])).values()]; target.sourceRefs = [...new Set([...target.sourceRefs, ...duplicate.sourceRefs])];
    target.extractionRunIds = [...new Set([...target.extractionRunIds, ...duplicate.extractionRunIds])];
    if (duplicate.explicit) { target.explicit = true; target.origin = duplicate.origin; }
  }
  return { revision: current.revision + 1, contextFingerprint: current.contextFingerprint, items };
}
export function publicExclusions(review: ExclusionReview) {
  return review.items.filter(i => i.state === "active").map(({ title, description }) => ({ title, description }));
}
export function addExclusionSuggestions(review: ExclusionReview, titles: string[], origin: "staff" | "ai_assumption", extractionRunId?: string): ExclusionReview {
  const items = [...review.items];
  for (const title of titles) if (!items.some(i => sameExclusion(i.title, title))) items.push({ ...item(title, origin), extractionRunIds: extractionRunId ? [extractionRunId] : [] });
  return { ...review, items };
}
export function carryExclusions(previous: ExclusionReview | null, removed: string[], changeId: string, reason: string, actor: string): ExclusionReview | null {
  if (!previous) return null;
  return { ...previous, revision: previous.revision + 1, items: previous.items.map(i => i.state === "active" && removed.includes(i.title) ? { ...i, state: "superseded", resolutionReason: reason, resolutionSourceRefs: ["change:" + changeId], reviewedBy: actor, reviewedAt: new Date().toISOString() } : i) };
}
export function requireExclusionsReviewed(review: ExclusionReview, document: { excluded?: unknown; exclusions?: unknown }) {
  const pending = review.items.filter(i => i.state === "pending");
  if (pending.length) throw new ApiError("EXCLUSIONS_REVIEW_REQUIRED", "고객이 명시한 제외 조건과 확인 필요 후보를 검토해주세요. 초안 저장은 가능하지만 승인 요청 전에는 검토가 필요합니다.", 422, { fieldErrors: pending.map(i => ({ fieldPath: "exclusions", message: `확인 필요: ${i.title}` })) });
  const expected = publicExclusions(review);
  if (fingerprint(document.excluded ?? null) !== fingerprint(expected.map(i => i.title)) || fingerprint(document.exclusions ?? null) !== fingerprint(expected)) throw new ApiError("EXCLUSIONS_DOCUMENT_MISMATCH", "검토한 제외 목록과 문서가 다릅니다. 최신 목록으로 초안을 저장해주세요.", 409);
}
