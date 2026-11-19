import assert from "node:assert/strict";
import test from "node:test";
import { credits } from "@/lib/ai/usage-policy";
import { GET } from "@/app/api/v1/service-policy/route";

test("public policy uses server credit prices and distinguishes a draft from an active subscription", async () => {
  const response = await GET(new Request("http://localhost:3101/api/v1/service-policy"));
  const policy = await response.json();
  assert.equal(response.status, 200); assert.equal(policy.billingEnabled, false);
  assert.deepEqual(policy.credits, credits); assert.equal(policy.charging.confirmedFailure, 0);
  assert.equal(policy.charging.cachedReuse, 0); assert.equal(policy.charging.pending, "RESERVED");
  assert.equal(policy.operator.email, "scopeflowservice@gmail.com");
  assert.ok(!JSON.stringify(policy).includes("DATABASE_URL"));
});
