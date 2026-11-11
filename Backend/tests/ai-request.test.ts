import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { numericReferences, refreshNumericReferences } from "@/lib/ai/numeric-references";
import { providerContext, completionBudget, comparisonReferences } from "@/lib/ai/request-budget";
import { GroqProvider } from "@/lib/ai/groq.provider";
import { initialAnalysisSchema, comparisonSchema, reviewNotesSchema } from "@/lib/model";
import { prompts } from "@/lib/ai/prompts";
import { recoverReviewNotes, comparisonReviewNotes, reviewNoteFields } from "@/lib/ai/structured-response";

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

test("budget counts decoded message text once and retains schema, metadata, UTF-8 and output limits", () => {
  const plain = { model: "test", messages: [{ role: "system", content: "policy" }, { role: "user", content: "a".repeat(6000) }], response_format: { type: "json_schema", schema: { type: "object" } } };
  const quoted = { ...plain, messages: [plain.messages[0], { role: "user", content: '\\"\n'.repeat(2000) }] };
  assert.equal(Buffer.byteLength(plain.messages[1].content), Buffer.byteLength(quoted.messages[1].content));
  assert.ok(Buffer.byteLength(JSON.stringify(quoted)) > Buffer.byteLength(JSON.stringify(plain)));
  assert.deepEqual(completionBudget("SCOPE_COMPARISON", quoted, 6000, 8000), completionBudget("SCOPE_COMPARISON", plain, 6000, 8000), "outer serialization cannot make equal-size model text exceed the budget");
  const boundary = { ...quoted, messages: [{ role: "user", content: quoted.messages[1].content + "a".repeat(13000) }] };
  assert.ok(Math.ceil(Buffer.byteLength(JSON.stringify(boundary), "utf8") / 3) + 256 + 1024 > 8000, "the previous wire-size calculation blocked this input");
  assert.ok(completionBudget("SCOPE_COMPARISON", boundary, 6000, 8000).maxCompletionTokens >= 1024);
  const original = structuredClone(quoted);
  const utf8 = completionBudget("SCOPE_COMPARISON", { ...plain, messages: [{ role: "user", content: "가".repeat(2000) }] }, 1400, 8000);
  assert.equal(utf8.maxCompletionTokens, 1400); assert.ok(utf8.estimatedInputTokens >= 2000 + 256);
  const over = { ...quoted, response_format: { schema: "s".repeat(22000) } };
  const previousWarn = console.warn; const logs: string[] = [];
  try {
    console.warn = value => logs.push(String(value));
    assert.throws(() => completionBudget("SCOPE_COMPARISON", over, 6000, 8000), error => {
      const failure = error as { code: string; rawResponse: string };
      assert.equal(failure.code, "AI_CONTEXT_TOO_LARGE"); const diagnostic = JSON.parse(failure.rawResponse);
      assert.equal(diagnostic.tokenBudget, 8000); assert.equal(diagnostic.minimumCompletionTokens, 1024);
      assert.ok(diagnostic.remainingTokens < 1024); assert.ok(diagnostic.transportEscapingBytes > 0);
      return true;
    });
  } finally { console.warn = previousWarn; }
  assert.equal(logs.length, 1); assert.equal(JSON.parse(logs[0]).event, "ai_request_budget_exceeded");
  assert.ok(!logs[0].includes(quoted.messages[1].content)); assert.deepEqual(quoted, original);
  assert.ok(completionBudget("SCOPE_COMPARISON", { ...plain, extraMetadata: "m".repeat(1000) }, 6000, 8000).estimatedInputTokens > completionBudget("SCOPE_COMPARISON", plain, 6000, 8000).estimatedInputTokens);
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
      assert.ok(completionBudget("SCOPE_COMPARISON", payload, 6000, 8000).estimatedInputTokens + output <= 8000);
      assert.ok(output <= 2600, "comparison does not reserve the old fixed 6000-token output");
      const wire = JSON.parse(request.messages[1].content);
      assert.deepEqual(wire.sources.map((s: { text: string }) => s.text), input.sources.map(s => s.text)); assert.deepEqual(wire.approvedBaseline, input.approvedBaseline);
      assert.equal(wire.confirmedRequirements, undefined);
      assert.deepEqual(request.response_format.json_schema.schema.properties.removedExclusions.items.enum, [excluded]);
      assert.ok(request.response_format.json_schema.schema.properties.proposedChanges.items.properties.requirementId.anyOf.some((v: { type: string }) => v.type === "null"), "ADD proposals retain the schema's nullable requirement link");
      const reply = structuredClone(candidate); reply.sourceRefs = wire.sources.map((s: { id: string }) => s.id); reply.newRequirements[0].sourceRefs = [wire.sources[1].id];
      return Response.json({ error: { code: "json_validate_failed", failed_generation: JSON.stringify(reply) } }, { status: 400 });
    };
    const result = await new GroqProvider().generate({ model: "openai/gpt-oss-120b", systemPrompt: prompts.SCOPE_COMPARISON.text, input, schema: comparisonSchema.extend({ reviewNotes: reviewNotesSchema }) });
    assert.equal(calls, 1); assert.ok(comparisonSchema.safeParse(result.data).success);
    assert.equal(result.data.noCostReason, null); assert.equal(result.data.noScheduleReason, null);
    assert.deepEqual(result.data.removedExclusions, [excluded]);
    assert.deepEqual(result.data.estimatedWork, candidate.estimatedWork);
    assert.deepEqual(result.data.reviewNotes.sourceRefs, candidate.sourceRefs); assert.deepEqual(result.data.newRequirements[0].sourceRefs, ["change:a"]);
    assert.deepEqual(input, before);
    assert.ok(result.data.numericReferences?.some(r => r.fieldPath === "estimatedWork.frontend" && r.value === 4));
  } finally { globalThis.fetch = original; }
});

test("comparison flat transport restores canonical notes and keeps every required list", async () => {
  const schema = comparisonSchema.extend({ reviewNotes: reviewNotesSchema });
  const previous = globalThis.fetch; let calls = 0;
  try {
    globalThis.fetch = async (_url, init) => {
      calls++; const request = JSON.parse(String(init?.body));
      const contract = request.response_format.json_schema.schema;
      assert.equal(request.response_format.json_schema.strict, true);
      assert.equal(contract.properties.reviewNotes, undefined);
      for (const key of reviewNoteFields) assert.ok(contract.properties[key] && contract.required.includes(key));
      assert.match(contract.properties.classification.description, /no new requirements/);
      assert.match(request.messages[0].content, /같은 페이지에 넣는 지도 위젯/);
      const source = JSON.parse(request.messages[1].content).sources[0].id;
      return Response.json({ choices: [{ message: { content: JSON.stringify({ classification: "UNCERTAIN", confidence: 0, reason: "승인 범위 근거를 확인합니다.", newRequirements: [], affectedExistingRequirements: [], removedExclusions: [], estimatedWork: { frontend: 0, backend: 0, design: 0, qa: 0 }, scheduleImpactDays: 0, sourceRefs: [source], constraints: [], excludedScope: [], assumptions: [], unresolvedItems: [], proposedChanges: [] }) }, finish_reason: "stop" }] });
    };
    const result = await new GroqProvider().generate({ model: "openai/gpt-oss-120b", systemPrompt: prompts.SCOPE_COMPARISON.text, input: { operation: "SCOPE_COMPARISON", sources: [{ id: "change:actual", text: "지도 위젯 추가" }] }, schema });
    assert.ok(schema.safeParse(result.data).success); assert.equal(result.recovery, undefined);
    assert.deepEqual(result.data.reviewNotes, { sourceRefs: ["change:actual"], constraints: [], excludedScope: [], assumptions: [], unresolvedItems: [], proposedChanges: [] });
    assert.equal(calls, 1);
  } finally { globalThis.fetch = previous; }
});

test("observed missing comparison lists become an explicit incomplete review without changing its facts or classification", async () => {
  const schema = comparisonSchema.extend({ reviewNotes: reviewNotesSchema });
  const candidate = { classification: "IN_SCOPE", confidence: 0.95, reason: "같은 페이지에 지도 위젯을 추가합니다.", newRequirements: [{ category: "지도", title: "지도 위젯", description: "기존 페이지 내부에 지도 iframe 추가", type: "FEATURE", priority: "MEDIUM", sourceRefs: ["s0"], implementation: { pageCount: 1, separatePage: false, serverWork: "NONE", featureTypes: ["EXTERNAL_INTEGRATION"], assets: [] } }], affectedExistingRequirements: [], removedExclusions: [], estimatedWork: { frontend: 2, backend: 0, design: 1, qa: 1 }, scheduleImpactDays: 0, reviewNotes: { constraints: [], excludedScope: [], assumptions: [] } };
  const original = structuredClone(candidate); const previous = globalThis.fetch; let calls = 0;
  try {
    for (const status of [200, 400, 422]) {
      globalThis.fetch = async () => { calls++; return status === 200 ? Response.json({ choices: [{ message: { content: JSON.stringify(candidate) }, finish_reason: "stop" }] }) : Response.json({ error: { ...(status === 400 ? { code: "json_validate_failed" } : {}), failed_generation: JSON.stringify(candidate) } }, { status }); };
      const result = await new GroqProvider().generate({ model: "openai/gpt-oss-120b", systemPrompt: prompts.SCOPE_COMPARISON.text, input: { operation: "SCOPE_COMPARISON", sources: [{ id: "change:actual", text: "같은 페이지에 지도 위젯을 추가합니다." }] }, schema });
      assert.ok(schema.safeParse(result.data).success);
      assert.equal(result.recovery?.kind, "PARTIAL_RESPONSE"); assert.equal(result.recovery?.providerStatus, status);
      assert.deepEqual(result.recovery?.missingFields, ["sourceRefs", "unresolvedItems", "proposedChanges"]);
      assert.deepEqual(result.data.reviewNotes.sourceRefs, [], "missing evidence is never invented");
      assert.equal(result.data.reviewNotes.unresolvedItems[0].important, true); assert.match(result.data.reviewNotes.unresolvedItems[0].description, /빈 목록은/);
      assert.equal(result.data.classification, "IN_SCOPE", "only the owner may resolve the conflicting scope judgment");
      assert.deepEqual(result.data.estimatedWork, candidate.estimatedWork);
      assert.deepEqual(result.data.newRequirements[0].sourceRefs, ["change:actual"]);
      assert.equal(result.rawResponse, JSON.stringify(candidate));
    }
    assert.equal(calls, 3, "one mock request per execution, no automatic retry");
    assert.deepEqual(candidate, original);
    const collision = comparisonReviewNotes({ ...candidate, reviewNotes: { ...candidate.reviewNotes, unresolvedItems: [{ id: "provider:missing-review-fields", description: "원래 AI 항목", important: false, sourceRefs: [] }] } }, schema, Object.keys(schema.shape));
    assert.equal(collision?.data.reviewNotes.unresolvedItems[1].id, "provider:missing-review-fields:missing");
    assert.equal(collision?.data.reviewNotes.unresolvedItems[1].important, true);
    for (const invalid of [{ ...candidate, estimatedWork: { ...candidate.estimatedWork, frontend: -1 } }, { ...candidate, reviewNotes: { ...candidate.reviewNotes, sourceRefs: null } }, { ...candidate, constraints: [] }, { ...candidate, reason: null }, { ...candidate, extra: "unrecognized" }]) assert.equal(comparisonReviewNotes(invalid, schema, Object.keys(schema.shape)), null);
    assert.equal(comparisonReviewNotes(null, schema, Object.keys(schema.shape)), null);
  } finally { globalThis.fetch = previous; }
});

test("comparison deduplicates only provable copies and restores short source references without rewriting prose", () => {
  const id = "request:00000000-0000-4000-8000-000000000001";
  const requirementId = "00000000-0000-4000-8000-000000000002";
  const text = `소개와 메뉴는 같은 1페이지입니다. 원문에 적힌 ${id} 문자열은 보존합니다.`;
  const input = { schemaVersion: 1, operation: "SCOPE_COMPARISON", sources: [{ id, text, kind: "REQUEST", revision: "r1", label: "고객 원문" }, { id: `requirement:${requirementId}`, text: "메뉴\n승인 당시의 설명", kind: "REQUIREMENT", revision: "r2" }, { id: "s0", text: "짧은 기존 ID도 보존", kind: "ANSWER", revision: "r3" }], explicitCustomerConstraints: [{ id: "page", value: 1, evidence: text, sourceRefs: [id] }, { id: "invalid", value: 2, evidence: "원문에 없는 주장", sourceRefs: [id] }], scopeExclusions: { items: [{ title: "서버 제외", sourceRefs: [id], evidence: [{ sourceRef: id, quote: text, revision: "r1" }] }, { title: "이전 근거 확인 필요", sourceRefs: [id], evidence: [{ sourceRef: id, quote: text, revision: "stale" }] }] }, approvedBaseline: { document: { requirements: [{ id: requirementId, title: "메뉴", description: "승인 당시의 설명" }, { id: requirementId, title: "메뉴", description: "다른 승인 버전의 설명은 삭제하지 않음" }], estimate: { total: 800000 }, durationDays: 8 } } };
  const before = structuredClone(input); const projected = providerContext(input) as typeof input;
  assert.equal(projected.explicitCustomerConstraints[0].evidence, undefined);
  assert.equal(projected.explicitCustomerConstraints[1].evidence, "원문에 없는 주장");
  assert.equal(projected.scopeExclusions.items[0].evidence, undefined); assert.deepEqual(projected.scopeExclusions.items[1].evidence, input.scopeExclusions.items[1].evidence);
  assert.equal(projected.approvedBaseline.document.requirements[0].description, undefined);
  assert.equal(projected.approvedBaseline.document.requirements[1].description, input.approvedBaseline.document.requirements[1].description);
  assert.deepEqual(projected.sources.map(s => [s.id, s.text, s.kind, s.revision]), input.sources.map(s => [s.id, s.text, s.kind, s.revision]));
  const codec = comparisonReferences(projected); const wire = codec.input as typeof input;
  assert.ok(!wire.sources.some(s => s.id === id)); assert.ok(!wire.sources.some(s => s.id === "s0"), "transport IDs cannot collide with canonical source IDs");
  assert.equal(wire.sources[0].text, text);
  const restored = codec.restore({ sourceRefs: [wire.sources[0].id, wire.sources[2].id, "unknown-alias"], evidence: text, reason: wire.sources[0].id, reviewNotes: { constraints: [{ sourceRefs: [wire.sources[1].id], supersedes: ["page"] }] } });
  assert.deepEqual(restored, { sourceRefs: [id, "s0", "unknown-alias"], evidence: text, reason: wire.sources[0].id, reviewNotes: { constraints: [{ sourceRefs: [`requirement:${requirementId}`], supersedes: ["page"] }] } });
  assert.deepEqual(input, before);
});

test("a multi-answer comparison that previously exhausted the input budget fits without dropping any source", async () => {
  const sources = Array.from({ length: 12 }, (_, i) => ({ id: `answer:00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, text: `질문 ${i + 1}: 제공 자료와 구현 범위는?\n소개와 메뉴는 같은 1페이지이며 로고·메뉴 자료는 고객이 제공합니다. 별도 서버와 결제·회원가입·관리자는 제외합니다.`, kind: "ANSWER", revision: `2026-11-03T00:00:${String(i).padStart(2, "0")}.000Z`, label: `저장된 고객 답변 ${i + 1} · 제공 자료와 구현 범위` }));
  const input = { schemaVersion: 1, operation: "SCOPE_COMPARISON", sources, explicitCustomerConstraints: Array.from({ length: 18 }, (_, i) => ({ id: `condition-${i}`, key: "pageCount", value: 1, status: "explicit", active: true, evidence: sources[i % sources.length].text, sourceRefs: [sources[i % sources.length].id, sources[(i + 1) % sources.length].id, sources[(i + 2) % sources.length].id], supersedes: [] })), approvedBaseline: { document: { requirements: [], excluded: ["결제", "회원가입", "관리자", "서버"], estimate: { total: 800000 }, durationDays: 8 } }, changeRequest: { request: "같은 페이지에 지도 iframe을 추가합니다." } };
  const original = globalThis.fetch; let calls = 0;
  try {
    globalThis.fetch = async (_url, options) => {
      calls++; const { max_completion_tokens: output, ...payload } = JSON.parse(String(options?.body));
      const wire = JSON.parse(payload.messages[1].content);
      assert.deepEqual(wire.sources.map((s: { text: string }) => s.text), sources.map(s => s.text));
      assert.equal(wire.explicitCustomerConstraints.length, input.explicitCustomerConstraints.length);
      assert.deepEqual(wire.approvedBaseline, input.approvedBaseline);
      assert.ok(output >= 1024); assert.ok(completionBudget("SCOPE_COMPARISON", payload, 6000, 8000).estimatedInputTokens + output <= 8000);
      const repeated = { ...payload, messages: [payload.messages[0], { role: "user", content: JSON.stringify(input) }] };
      assert.throws(() => completionBudget("SCOPE_COMPARISON", repeated, 6000, 8000), { code: "AI_CONTEXT_TOO_LARGE" });
      return Response.json({ choices: [{ message: { content: JSON.stringify({ classification: "UNCERTAIN", confidence: 0, reason: "지도 구현 범위를 담당자가 검토합니다.", newRequirements: [], affectedExistingRequirements: [], removedExclusions: [], estimatedWork: { frontend: 0, backend: 0, design: 0, qa: 0 }, scheduleImpactDays: 0, reviewNotes: { sourceRefs: [wire.sources[0].id], constraints: [], excludedScope: [], assumptions: [], unresolvedItems: [], proposedChanges: [] } }) }, finish_reason: "stop" }] });
    };
    const result = await new GroqProvider().generate({ model: "openai/gpt-oss-120b", systemPrompt: prompts.SCOPE_COMPARISON.text, input, schema: comparisonSchema.extend({ reviewNotes: reviewNotesSchema }) });
    assert.deepEqual(result.data.reviewNotes.sourceRefs, [sources[0].id]); assert.equal(calls, 1);
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
