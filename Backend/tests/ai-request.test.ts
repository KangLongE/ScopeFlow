import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { numericReferences, refreshNumericReferences } from "@/lib/ai/numeric-references";
import { providerContext, completionBudget } from "@/lib/ai/request-budget";
import { GroqProvider } from "@/lib/ai/groq.provider";
import { initialAnalysisSchema, comparisonSchema, reviewNotesSchema } from "@/lib/model";
import { prompts } from "@/lib/ai/prompts";
import { recoverReviewNotes } from "@/lib/ai/structured-response";

Object.assign(process.env, { DATABASE_URL: "postgresql://127.0.0.1:5432/test", BETTER_AUTH_SECRET: "test-only-" + "x".repeat(32), BETTER_AUTH_URL: "http://localhost:3101", FRONTEND_URL: "http://localhost:3100", GROQ_API_KEY: "test-only", AI_MAX_OUTPUT_TOKENS: "6000", AI_REQUEST_TOKEN_BUDGET: "8000" });

test("provider projection preserves every source, baseline and page facts without duplicated answers/audit trails", () => {
  const input = { schemaVersion: 1, sources: [{ id: "answer:a", text: "같은 1페이지, 로고 고객 제공", revision: "1" }], savedAnswers: [{ questionId: "q", answerId: "a", sourceRef: "answer:a", answer: "같은 1페이지, 로고 고객 제공" }], confirmedRequirements: [{ id: "r", provenance: { implementation: { pageCount: 1 }, rawRunHistory: "x".repeat(1000) } }], explicitCustomerConstraints: [{ key: "pageCount", value: 1 }], approvedBaseline: { document: { requirements: [{ id: "r" }], estimate: { total: 800000 } } } };
  const original = structuredClone(input); const wire = providerContext(input) as typeof input;
  assert.deepEqual(wire.sources, input.sources); assert.deepEqual(wire.approvedBaseline, input.approvedBaseline); assert.deepEqual(wire.explicitCustomerConstraints, input.explicitCustomerConstraints);
  assert.deepEqual(input, original); assert.ok(JSON.stringify(wire).length < JSON.stringify(input).length);
  const small = completionBudget("SCOPE_COMPARISON", wire, 6000, 6000);
  assert.ok(small.maxCompletionTokens <= 2600); assert.ok(small.maxCompletionTokens + small.estimatedInputTokens <= 6000);
  assert.throws(() => completionBudget("INITIAL_ANALYSIS", "가".repeat(10000), 6000, 6000), { code: "AI_CONTEXT_TOO_LARGE" });
});

test("canonical numeric links resolve exact nested fields and preserve zero without copying model paths", () => {
  const value = { estimatedWork: { frontend: 2, backend: 0 }, items: [{ hours: { qa: 1.5 } }], budget: { amount: null }, numericReferences: [{ fieldPath: "made.up", value: 9 }] };
  assert.deepEqual(numericReferences(value).map(r => [r.fieldPath, r.value]), [["estimatedWork.backend", 0], ["estimatedWork.frontend", 2], ["items.0.hours.qa", 1.5]]);
  const draft = { estimatedWork: { qa: 2 }, numericReferences: [{ fieldPath: "estimatedWork.qa", value: 1, text: "estimatedWork.qa = 1" }, { fieldPath: "made.up", value: 8, text: "QA 8h" }] };
  const refreshed = refreshNumericReferences(draft);
  assert.equal(refreshed.numericReferences.find(r => r.fieldPath === "estimatedWork.qa")!.value, 2);
  assert.ok(refreshed.numericReferences.some(r => r.fieldPath === "made.up" && r.value === 8), "actual prose claims are not silently corrected");
  assert.equal(draft.numericReferences[0].value, 1);
});

test("first analysis strict request has no invented numeric path contract, and length cutoff fails closed", async () => {
  const original = globalThis.fetch; let calls = 0;
  try {
    globalThis.fetch = async (_url, init) => {
      calls++; const request = JSON.parse(String(init?.body)); const schema = request.response_format.json_schema.schema;
      assert.equal(schema.properties.numericReferences, undefined); assert.ok(!schema.required.includes("numericReferences"));
      assert.equal(schema.properties.features.items.properties.existingRequirementId.type, "null");
      assert.equal(request.reasoning_effort, "low"); assert.equal(request.include_reasoning, false); assert.ok(request.max_completion_tokens < 6000);
      return Response.json({ choices: [{ message: { content: '{"budget":{"amount":1000000}}' }, finish_reason: "length" }] });
    };
    await assert.rejects(new GroqProvider().generate({ model: "openai/gpt-oss-120b", systemPrompt: prompts.INITIAL_ANALYSIS.text, input: { operation: "INITIAL_ANALYSIS", sources: [{ id: "request:a", text: "카페 소개 웹사이트, 예산 100만원" }] }, schema: initialAnalysisSchema }), { code: "AI_OUTPUT_TRUNCATED" });
    assert.equal(calls, 1);
    globalThis.fetch = async () => Response.json({ choices: [{ message: { content: '{"hours":{"qa":0}}' }, finish_reason: "stop" }] });
    const schema = z.object({ hours: z.object({ qa: z.number() }), numericReferences: z.array(z.unknown()).optional() });
    const result = await new GroqProvider().generate({ model: "openai/gpt-oss-20b", systemPrompt: "test", input: {}, schema });
    assert.deepEqual(result.data.numericReferences, [{ fieldPath: "hours.qa", value: 0, text: "hours.qa = 0" }]);
  } finally { globalThis.fetch = original; }
});

test("observed Groq 400 misplaced reviewNotes arrays recover without retry or changing any fact", async () => {
  const schema = z.object({ summary: z.string(), reviewNotes: reviewNotesSchema });
  const candidate = { summary: "카페 소개와 메뉴", reviewNotes: { assumptions: [] }, sourceRefs: ["request:a"], constraints: [], excludedScope: [], unresolvedItems: [], proposedChanges: [] };
  const before = structuredClone(candidate);
  assert.deepEqual(recoverReviewNotes(candidate, schema, ["summary", "reviewNotes"]), { summary: candidate.summary, reviewNotes: { assumptions: [], sourceRefs: ["request:a"], constraints: [], excludedScope: [], unresolvedItems: [], proposedChanges: [] } });
  assert.deepEqual(candidate, before);
  assert.equal(recoverReviewNotes({ ...candidate, reviewNotes: { ...candidate.reviewNotes, sourceRefs: ["conflict"] } }, schema, ["summary", "reviewNotes"]), null);
  assert.equal(recoverReviewNotes({ ...candidate, constraints: undefined }, schema, ["summary", "reviewNotes"]), null);
  const comparison = schema.extend({ removedExclusions: z.array(z.string()), noCostReason: z.string().nullable().optional() });
  const repaired = recoverReviewNotes({ ...candidate, removedExclusions: ["excluded:map"], noCostReason: null }, comparison, ["summary", "reviewNotes", "removedExclusions", "noCostReason"], new Map([["excluded:map", "외부 서비스 연동 개발 제외"]]));
  assert.deepEqual(repaired?.removedExclusions, ["외부 서비스 연동 개발 제외"]); assert.equal(repaired?.noCostReason, null);
  const original = globalThis.fetch; let calls = 0;
  try {
    globalThis.fetch = async () => { calls++; return Response.json({ error: { code: "json_validate_failed", failed_generation: JSON.stringify(candidate) } }, { status: 400 }); };
    const result = await new GroqProvider().generate({ model: "openai/gpt-oss-120b", systemPrompt: "test", input: {}, schema });
    assert.equal(calls, 1); assert.equal(result.data.summary, candidate.summary); assert.equal(result.usageKnown, false); assert.equal(result.recovery?.providerStatus, 400); assert.equal(result.rawResponse, JSON.stringify(candidate));
  } finally { globalThis.fetch = original; }
});

test("comparison keeps its approved baseline and sources within the token budget and accepts the observed null reasons", async () => {
  const requirementId = "7e70fb4e-0b68-49e8-b1cb-ac520ba24273";
  const excluded = "외부 서비스 연동 개발 제외";
  const input = { schemaVersion: 1, operation: "SCOPE_COMPARISON", sources: [{ id: "request:a", text: "소개와 메뉴는 같은 1페이지입니다. 외부 연동은 제외합니다." }, { id: "change:a", text: "같은 페이지에 외부 지도 iframe을 추가하고 외부 연동 제외만 해제합니다." }], confirmedRequirements: [{ id: requirementId, provenance: { history: "irrelevant audit history".repeat(3000) } }], approvedBaseline: { document: { requirements: [{ id: requirementId, title: "카페 소개와 메뉴" }], excluded: [excluded], estimate: { total: 660000 }, durationDays: 8 } }, scopeExclusions: { items: [{ id: "excluded:map", title: excluded }] } };
  const candidate = { classification: "OUT_OF_SCOPE", confidence: 0.9, reason: "승인 범위에서 제외된 지도 연동을 추가합니다.", newRequirements: [{ category: "지도", title: "외부 지도 iframe", description: "같은 1페이지 내부에 지도 iframe을 추가합니다.", type: "EXTERNAL_INTEGRATION", priority: "MEDIUM", sourceRefs: ["change:a"], implementation: { pageCount: 1, separatePage: false, serverWork: "NONE", featureTypes: ["EXTERNAL_INTEGRATION"], assets: [] } }], affectedExistingRequirements: [], removedExclusions: ["excluded:map"], estimatedWork: { frontend: 4, backend: 2, design: 2, qa: 1 }, scheduleImpactDays: 2, noCostReason: null, noScheduleReason: null, reviewNotes: { constraints: [], excludedScope: [], assumptions: [], unresolvedItems: [], proposedChanges: [] }, sourceRefs: ["request:a", "change:a"] };
  const before = structuredClone(input); const original = globalThis.fetch; let calls = 0;
  try {
    globalThis.fetch = async (_url, options) => {
      calls++; const request = JSON.parse(String(options?.body));
      const { max_completion_tokens: output, ...payload } = request;
      assert.ok(Math.ceil(Buffer.byteLength(JSON.stringify(payload), "utf8") / 3) + 256 + output <= 8000);
      assert.ok(output <= 2600, "comparison does not reserve the old fixed 6000-token output");
      const wire = JSON.parse(request.messages[1].content);
      assert.deepEqual(wire.sources, input.sources); assert.deepEqual(wire.approvedBaseline, input.approvedBaseline);
      assert.equal(wire.confirmedRequirements, undefined);
      assert.deepEqual(request.response_format.json_schema.schema.properties.removedExclusions.items.enum, [excluded]);
      return Response.json({ error: { code: "json_validate_failed", failed_generation: JSON.stringify(candidate) } }, { status: 400 });
    };
    const result = await new GroqProvider().generate({ model: "openai/gpt-oss-120b", systemPrompt: prompts.SCOPE_COMPARISON.text, input, schema: comparisonSchema.extend({ reviewNotes: reviewNotesSchema }) });
    assert.equal(calls, 1); assert.ok(comparisonSchema.safeParse(result.data).success);
    assert.equal(result.data.noCostReason, null); assert.equal(result.data.noScheduleReason, null);
    assert.deepEqual(result.data.removedExclusions, [excluded]);
    assert.deepEqual(result.data.estimatedWork, candidate.estimatedWork);
    assert.deepEqual(input, before);
    assert.ok(result.data.numericReferences?.some(r => r.fieldPath === "estimatedWork.frontend" && r.value === 4));
  } finally { globalThis.fetch = original; }
});

test("an oversized comparison is blocked before sending any provider request", async () => {
  const original = globalThis.fetch; let calls = 0;
  try {
    globalThis.fetch = async () => { calls++; throw new Error("No external request is allowed"); };
    await assert.rejects(new GroqProvider().generate({ model: "openai/gpt-oss-120b", systemPrompt: prompts.SCOPE_COMPARISON.text, input: { schemaVersion: 1, operation: "SCOPE_COMPARISON", sources: [{ id: "request:a", text: "가".repeat(12000) }] }, schema: comparisonSchema.extend({ reviewNotes: reviewNotesSchema }) }), { code: "AI_CONTEXT_TOO_LARGE", status: 413 });
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

test("provider limit failures distinguish temporary shared usage from an oversized request without retrying", async () => {
  const original = globalThis.fetch; let calls = 0;
  const schema = z.object({ summary: z.string() });
  try {
    const cases = [
      { status: 429, message: "Rate limit reached on tokens per minute (TPM): Limit 8,000, Used 6,000, Requested 3,000", retry: "2.5", code: "AI_PROVIDER_RATE_LIMITED", http: 429, used: 6000, wait: 3 },
      { status: 429, message: "Request too large on tokens per minute (TPM): Limit 8,000, Requested 9,000", retry: "2", code: "AI_CONTEXT_TOO_LARGE", http: 413, used: null, wait: 2 },
      { status: 413, message: "Request too large on tokens per minute (TPM): Limit 8,000, Requested 9,000", retry: "invalid", code: "AI_CONTEXT_TOO_LARGE", http: 413, used: null, wait: null },
      { status: 429, message: "Rate limit reached on tokens per day (TPD): Limit 200000, Used 199000, Requested 2000", retry: null, code: "AI_PROVIDER_RATE_LIMITED", http: 429, used: 199000, wait: null },
    ];
    for (const fixture of cases) {
      globalThis.fetch = async () => { calls++; return Response.json({ error: { message: fixture.message } }, { status: fixture.status, headers: fixture.retry === null ? {} : { "retry-after": fixture.retry } }); };
      await assert.rejects(new GroqProvider().generate({ model: "openai/gpt-oss-120b", systemPrompt: "test", input: {}, schema }), error => {
        const failure = error as Error & { code: string; status: number; rawResponse: string };
        assert.equal(failure.code, fixture.code); assert.equal(failure.status, fixture.http);
        const diagnostic = JSON.parse(failure.rawResponse);
        assert.equal(diagnostic.status, fixture.status); assert.equal(diagnostic.used, fixture.used); assert.equal(diagnostic.retryAfterSeconds, fixture.wait);
        if (fixture.http === 413) assert.match(failure.message, /반복 실행보다/);
        else if (fixture.wait !== null) assert.match(failure.message, /최소 3초/);
        return true;
      });
    }
    assert.equal(calls, cases.length, "exactly one request for each explicit execution, no retries");
  } finally { globalThis.fetch = original; }
});
