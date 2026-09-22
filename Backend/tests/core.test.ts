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
    const [{ GroqProvider }, { z }] = await Promise.all([import("@/lib/ai/groq.provider"), import("zod")]);
    const result = await new GroqProvider().generate({ model: "openai/gpt-oss-20b", systemPrompt: "test", input: {}, schema: z.object({ answer: z.literal("ok") }) });
    assert.deepEqual(result, { data: { answer: "ok" }, inputTokens: 4, outputTokens: 2, cachedTokens: 0 });
  } finally {
    globalThis.fetch = original;
  }
});

test("frontend command contract validates nested estimate input", async () => {
  configureTestEnv();
  const { commandSchema } = await import("@/lib/services/command.service");
  const command = commandSchema.parse({ action: "estimate.item", projectId: "00000000-0000-4000-8000-000000000001", requirementId: "00000000-0000-4000-8000-000000000002", hours: { frontend: 1, backend: 2, design: 0, qa: 0.5 }, reason: "담당자 검토" });
  assert.equal(command.action, "estimate.item");
  assert.throws(() => commandSchema.parse({ ...command, hours: { ...command.hours, qa: -1 } }));
});
