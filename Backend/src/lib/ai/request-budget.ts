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
  }
  return c;
}

export function completionBudget(operation: string | undefined, request: unknown, configuredMax: number, tokenBudget: number) {
  const estimatedInputTokens = Math.ceil(Buffer.byteLength(JSON.stringify(request), "utf8") / 3) + 256;
  const stageMax = operation === "QUESTIONS" ? 1200 : ["INITIAL_ANALYSIS", "SCOPE_COMPARISON", "SCOPE_SUMMARY"].includes(operation ?? "") ? 2600 : 3600;
  const maxCompletionTokens = Math.min(configuredMax, stageMax, tokenBudget - estimatedInputTokens);
  if (maxCompletionTokens < 1024) throw new AIResponseError("AI_CONTEXT_TOO_LARGE", "고객 원문·승인 범위를 보존한 입력과 응답이 설정된 토큰 예산을 초과합니다. AI_REQUEST_TOKEN_BUDGET과 계정 한도를 확인하거나 수동 검토를 계속해주세요.", JSON.stringify({ estimatedInputTokens, tokenBudget, configuredMax }), 413);
  return { estimatedInputTokens, maxCompletionTokens };
}
