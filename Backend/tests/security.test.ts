import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { trustedOrigins } from "@/lib/origins";
import { json, route, safeRoutePath } from "@/lib/http";
import { ApiError } from "@/lib/errors";

test("CORS and authentication share exact origins, including local aliases and trailing slashes", () => {
  assert.deepEqual(trustedOrigins("http://localhost:3100/"), ["http://localhost:3100", "http://127.0.0.1:3100"]);
  assert.deepEqual(trustedOrigins("https://scopeflow.example.invalid/"), ["https://scopeflow.example.invalid"]);
  const previous = process.env.FRONTEND_URL;
  process.env.FRONTEND_URL = "https://scopeflow.example.invalid/";
  try {
    const valid = proxy(new NextRequest("https://api.example.invalid/api/v1/projects", { method: "OPTIONS", headers: { origin: "https://scopeflow.example.invalid", "access-control-request-method": "POST" } }));
    assert.equal(valid.status, 204);
    assert.equal(valid.headers.get("access-control-allow-origin"), "https://scopeflow.example.invalid");
    assert.equal(valid.headers.get("access-control-allow-credentials"), "true");
    assert.equal(valid.headers.get("vary"), "Origin");
    for (const origin of ["null", "https://scopeflow.example.invalid.attacker.invalid", "https://preview.example.invalid", "http://scopeflow.example.invalid"]) {
      const rejected = proxy(new NextRequest("https://api.example.invalid/api/v1/projects", { headers: { origin } }));
      assert.equal(rejected.status, 403);
      assert.equal(rejected.headers.has("access-control-allow-origin"), false);
    }
  } finally { if (previous === undefined) delete process.env.FRONTEND_URL; else process.env.FRONTEND_URL = previous; }
});

test("success and failure logs redact public approval tokens and never log URL queries", async () => {
  const token = "private-share-token";
  const url = `https://api.example.invalid/api/v1/client-access/${token}/scope/approve?private=customer-data`;
  assert.equal(safeRoutePath(url), "/api/v1/client-access/[redacted]/scope/approve");
  const previousInfo = console.info, previousError = console.error, logs: string[] = [];
  console.info = value => logs.push(String(value)); console.error = value => logs.push(String(value));
  try {
    const ok = await route(async () => json({ ok: true }))(new Request(url));
    const rejected = await route(async () => { throw new ApiError("TEST_FAILURE", "거절됨", 403); })(new Request(url));
    assert.equal(ok.headers.get("cache-control"), "private, no-store");
    assert.equal(rejected.headers.get("cache-control"), "private, no-store");
    assert.equal(logs.length, 2);
    assert.ok(logs.every(line => !line.includes(token) && !line.includes("customer-data") && line.includes("[redacted]")));
  } finally { console.info = previousInfo; console.error = previousError; }
});
