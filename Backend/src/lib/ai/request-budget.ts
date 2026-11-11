import { AIResponseError } from "./provider";

// Keep every source text and immutable baseline; remove only duplicate source text and internal audit metadata.
export function providerContext(input: unknown): unknown {
  if (!input || typeof input !== "object" || !("schemaVersion" in input) || !("sources" in input)) return input;
  const c = structuredClone(input) as Record<string, unknown>;
  const rows = (value: unknown) => Array.isArray(value) ? value as Record<string, unknown>[] : [];
  c.savedAnswers = rows(c.savedAnswers).map(({ questionId, answerId, sourceRef }) => ({ questionId, answerId, sourceRef }));
  c.existingQuestions = rows(c.existingQuestions).map(({ id, important, answered, sourceRef }) => ({ id, important, answered, sourceRef }));
  c.confirmedRequirements = rows(c.confirmedRequirements).map(({ provenance, ...r }) => {
    const source = rows(c.sources).find(s => s.id === r.sourceRef);
    if (source?.text === `${r.title}\n${r.description}`) delete r.description;
    return { ...r, provenance: provenance && typeof provenance === "object" ? { implementation: (provenance as Record<string, unknown>).implementation, sourceRefs: (provenance as Record<string, unknown>).sourceRefs } : null };
  });
  if (c.scopeExclusions && typeof c.scopeExclusions === "object") c.scopeExclusions = { items: rows((c.scopeExclusions as Record<string, unknown>).items).map(({ id, title, state, explicit, sourceRefs, evidence, resolutionReason, resolutionSourceRefs }) => ({ id, title, state, explicit, sourceRefs, evidence, resolutionReason, resolutionSourceRefs })) };
  delete c.confirmedIncludedScope; delete c.pageConfirmations;
  // The model never needs client contact information to compare approved requirements and amounts.
  const baseline = c.approvedBaseline as { document?: Record<string, unknown> } | null;
  if (baseline?.document) delete baseline.document.client;
  if (c.operation === "SCOPE_COMPARISON" && baseline?.document) {
    // The approved document (not today's unapproved estimate/draft) is the comparison contract.
    for (const key of ["confirmedRequirements", "confirmedEstimate", "rateCard", "scopeDraft", "appliedAnalysis", "existingRequirements", "savedAnswers", "existingQuestions"]) delete c[key];
    const sources = new Map(rows(c.sources).map(s => [s.id, s]));
    const evidenceOnce = (row: Record<string, unknown>) => {
      const result = { ...row }; const refs = Array.isArray(row.sourceRefs) ? row.sourceRefs : [];
      const quoted = (ref: unknown, quote: unknown) => typeof quote === "string" && quote.length > 0 && refs.includes(ref) && typeof sources.get(ref)?.text === "string" && (sources.get(ref)!.text as string).includes(quote);
      if (typeof row.evidence === "string" && refs.some(ref => quoted(ref, row.evidence))) delete result.evidence;
      if (Array.isArray(row.evidence) && row.evidence.length > 0 && row.evidence.every(e => e && quoted(e.sourceRef, e.quote) && e.revision === sources.get(e.sourceRef)?.revision)) delete result.evidence;
      return result;
    };
    for (const key of ["explicitCustomerConstraints", "confirmedExcludedScope"]) if (Array.isArray(c[key])) c[key] = rows(c[key]).map(evidenceOnce);
    if (c.scopeExclusions && typeof c.scopeExclusions === "object") (c.scopeExclusions as Record<string, unknown>).items = rows((c.scopeExclusions as Record<string, unknown>).items).map(evidenceOnce);
    if (Array.isArray(baseline.document.requirements)) baseline.document.requirements = rows(baseline.document.requirements).map(r => {
      const source = sources.get(`requirement:${r.id}`);
      if (source?.text !== `${r.title}\n${r.description}`) return r;
      const result: Record<string, unknown> = { ...r, sourceRef: source.id }; delete result.description;
      return result;
    });
    // Labels repeat the source text; keep its exact content, kind and revision, including older revisions.
    c.sources = rows(c.sources).map(({ id, text, kind, revision }) => ({ id, text, kind, revision }));
  }
  return c;
}

// Only reference fields use short transport IDs. Prose and stored context retain their original values.
export function comparisonReferences(input: unknown) {
  const identity = (value: unknown) => value;
  if (!input || typeof input !== "object" || (input as { operation?: string }).operation !== "SCOPE_COMPARISON" || !Array.isArray((input as { sources?: unknown }).sources)) return { input, restore: identity };
  const sourceRows = (input as { sources: { id: string }[] }).sources;
  const originals = new Set(sourceRows.map(s => s.id)); const forward = new Map<string, string>();
  let index = 0;
  for (const source of sourceRows) {
    let alias: string; do { alias = `s${(index++).toString(36)}`; } while (originals.has(alias));
    if (!forward.has(source.id)) forward.set(source.id, alias);
  }
  const backward = new Map([...forward].map(([id, alias]) => [alias, id]));
  const fields = new Set(["sourceRef", "sourceRefs", "originalSourceRef", "resolutionSourceRefs", "evidenceRefs"]);
  const replace = (value: unknown, mapping: Map<string, string>, field = ""): unknown => {
    if (typeof value === "string") return fields.has(field) ? mapping.get(value) ?? value : value;
    if (Array.isArray(value)) return value.map(v => replace(v, mapping, field));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, replace(v, mapping, key)]));
    return value;
  };
  const wire = replace(input, forward) as { sources: { id: string }[] };
  wire.sources = wire.sources.map(s => ({ ...s, id: forward.get(s.id)! }));
  return { input: wire, restore: (value: unknown) => replace(value, backward) };
}

export function completionBudget(operation: string | undefined, request: unknown, configuredMax: number, tokenBudget: number) {
  const requestBytes = Buffer.byteLength(JSON.stringify(request), "utf8");
  let transportEscapingBytes = 0;
  const messages = request && typeof request === "object" ? (request as { messages?: unknown }).messages : undefined;
  if (Array.isArray(messages)) for (const message of messages) {
    const content = message && typeof message === "object" ? (message as { content?: unknown }).content : undefined;
    // HTTP JSON escaping is decoded before the model reads the message; keep the actual content unchanged.
    if (typeof content === "string") transportEscapingBytes += Buffer.byteLength(JSON.stringify(content), "utf8") - Buffer.byteLength(content, "utf8");
  }
  const estimatedInputTokens = Math.ceil((requestBytes - transportEscapingBytes) / 3) + 256;
  const stageMax = operation === "QUESTIONS" ? 1200 : ["INITIAL_ANALYSIS", "SCOPE_COMPARISON", "SCOPE_SUMMARY"].includes(operation ?? "") ? 2600 : 3600;
  const maxCompletionTokens = Math.min(configuredMax, stageMax, tokenBudget - estimatedInputTokens);
  if (maxCompletionTokens < 1024) {
    const diagnostic = { estimatedInputTokens, tokenBudget, configuredMax, remainingTokens: tokenBudget - estimatedInputTokens, minimumCompletionTokens: 1024, maxCompletionTokens, requestBytes, transportEscapingBytes };
    console.warn(JSON.stringify({ event: "ai_request_budget_exceeded", operation, ...diagnostic }));
    throw new AIResponseError("AI_CONTEXT_TOO_LARGE", "고객 원문·승인 범위를 보존한 입력과 응답이 설정된 토큰 예산을 초과합니다. AI_REQUEST_TOKEN_BUDGET과 계정 한도를 확인하거나 수동 검토를 계속해주세요.", JSON.stringify(diagnostic), 413);
  }
  return { estimatedInputTokens, maxCompletionTokens };
}
