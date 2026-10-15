import assert from "node:assert/strict";
import test from "node:test";
import { calculateAmount, nextVersion } from "@/lib/model";
import { requireOwner } from "@/lib/auth/permissions";

const configureTestEnv = () => Object.assign(process.env, {
  DATABASE_URL: "postgresql://127.0.0.1:5432/test",
  BETTER_AUTH_SECRET: ["test-only", "x".repeat(32)].join("-"),
  BETTER_AUTH_URL: "http://localhost:3001",
  FRONTEND_URL: "http://localhost:3000",
  GROQ_API_KEY: "test-only",
});

test("navigation session reads have their own limit without weakening sign-in protection", async () => {
  configureTestEnv();
  const { auth } = await import("@/lib/auth/auth");
  assert.equal(auth.options.rateLimit?.enabled, true);
  assert.equal(auth.options.rateLimit?.max, 20);
  assert.deepEqual(auth.options.rateLimit?.customRules, { "/get-session": { window: 60, max: 120 } });
});

test("estimate, scope version, credit and permission rules", async () => {
  assert.equal(calculateAmount({ frontend: 2, backend: 3, design: 1, qa: 0.5 }, { frontend: 50_000, backend: 60_000, design: 45_000, qa: 40_000 }), 345_000);
  assert.deepEqual(nextVersion(null), { majorVersion: 1, minorVersion: 0 });
  assert.deepEqual(nextVersion({ majorVersion: 1, minorVersion: 4 }), { majorVersion: 1, minorVersion: 5 });
  assert.doesNotThrow(() => requireOwner({ userId: "u", workspaceId: "w", role: "OWNER" }));
  assert.throws(() => requireOwner({ userId: "u", workspaceId: "w", role: "MEMBER" }), /소유자/);

  configureTestEnv();
  const { creditCost } = await import("@/lib/ai/ai.service");
  assert.equal(creditCost("INITIAL_ANALYSIS"), 2);
  assert.equal(creditCost("SCOPE_COMPARISON"), 3);
});

test("Groq structured response is validated without a real API call", async () => {
  configureTestEnv();
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ choices: [{ message: { content: '{"answer":"ok"}' } }], usage: { prompt_tokens: 4, completion_tokens: 2 } });
  try {
    const [{ GroqProvider, groqJSONSchema }, { z }] = await Promise.all([import("@/lib/ai/groq.provider"), import("zod")]);
    assert.deepEqual(groqJSONSchema(z.toJSONSchema(z.object({ items: z.array(z.object({ id: z.string().uuid() })).max(8), mode: z.literal("TEST") }))), { type: "object", properties: { items: { type: "array", items: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false } }, mode: { type: "string", enum: ["TEST"] } }, required: ["items", "mode"], additionalProperties: false });
    const result = await new GroqProvider().generate({ model: "openai/gpt-oss-20b", systemPrompt: "test", input: {}, schema: z.object({ answer: z.literal("ok") }) });
    assert.deepEqual(result, { data: { answer: "ok" }, inputTokens: 4, outputTokens: 2, cachedTokens: 0, rawResponse: '{"answer":"ok"}', usageKnown: true });
  } finally {
    globalThis.fetch = original;
  }
});

test("frontend command contract validates nested estimate input", async () => {
  configureTestEnv();
  const { commandSchema } = await import("@/lib/services/command.service");
  const command = commandSchema.parse({ action: "estimate.item", candidateRevision: 0, projectId: "00000000-0000-4000-8000-000000000001", requirementId: "00000000-0000-4000-8000-000000000002", hours: { frontend: 1, backend: 2, design: 0, qa: 0.5 }, reason: "담당자 검토" });
  assert.equal(command.action, "estimate.item");
  assert.throws(() => commandSchema.parse({ ...command, hours: { ...command.hours, qa: -1 } }));
  for (const candidateRevision of [undefined, null, "", -1]) assert.throws(() => commandSchema.parse({ ...command, candidateRevision }));
});

test("prompt-only upgrades allow revalidation, changed evidence still conflicts", async () => {
  configureTestEnv();
  const [{ isFreshAIContext }, { fingerprint }] = await Promise.all([import("@/lib/services/ai-context.service"), import("@/lib/fingerprint")]);
  const before = { operation: "ESTIMATE", promptVersion: "before", project: { name: "저장된 고객 근거" } };
  const context = { ...before, inputFingerprint: fingerprint(before) };
  const after = { ...before, promptVersion: "after" };
  const current = { ...after, inputFingerprint: fingerprint(after) } as Parameters<typeof isFreshAIContext>[0];
  assert.equal(isFreshAIContext(current, { context, inputFingerprint: context.inputFingerprint }), true);
  assert.equal(isFreshAIContext(current, { context, inputFingerprint: "untrusted" }), false);
  assert.equal(isFreshAIContext({ ...current, project: { ...current.project, name: "바뀐 근거" } }, { context, inputFingerprint: context.inputFingerprint }), false);
});

test("Groq source contract, no automatic retry and actionable limits", async () => {
  configureTestEnv();
  const original = globalThis.fetch;
  const [{ GroqProvider }, { z }] = await Promise.all([import("@/lib/ai/groq.provider"), import("zod")]);
  const provider = new GroqProvider();
  const options = { model: "openai/gpt-oss-120b", systemPrompt: "test", input: { sources: [{ id: "request:actual", text: "complete original" }] }, schema: z.object({ sourceRefs: z.array(z.string()), type: z.literal("TEST") }) };
  let calls = 0;
  try {
    globalThis.fetch = async (_url, init) => {
      calls++; const wire = JSON.parse(String(init?.body));
      assert.deepEqual(wire.response_format.json_schema.schema.$defs.scopeflow_source.enum, ["request:actual"]);
      assert.deepEqual(JSON.parse(wire.messages[1].content), options.input);
      return Response.json({ error: { code: "json_validate_failed", failed_generation: "{broken" } }, { status: 400 });
    };
    await assert.rejects(provider.generate(options), { code: "AI_PROVIDER_ERROR" }); assert.equal(calls, 1);
    for (const [status, code] of [[413, "AI_CONTEXT_TOO_LARGE"], [429, "AI_PROVIDER_RATE_LIMITED"], [400, "AI_PROVIDER_ERROR"]] as const) {
      calls = 0; globalThis.fetch = async () => { calls++; return Response.json({ error: { code: "other" } }, { status }); };
      await assert.rejects(provider.generate(options), { code, status: status === 400 ? 502 : status }); assert.equal(calls, 1);
    }
    calls = 0; globalThis.fetch = async () => { calls++; return Response.json({ error: { code: "json_validate_failed" } }, { status: 400 }); };
    await assert.rejects(provider.generate(options), { code: "AI_PROVIDER_ERROR" }); assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});
