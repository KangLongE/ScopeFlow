import assert from "node:assert/strict";
import test from "node:test";
import { backendBaseUrl, backendFetch } from "../src/lib/api";

test("backend URL has a stable local default and no trailing slash", () => {
  const previous = process.env.BACKEND_URL;
  try {
    delete process.env.BACKEND_URL;
    assert.equal(backendBaseUrl(), "http://127.0.0.1:3001");
    process.env.BACKEND_URL = "https://api.example.test/";
    assert.equal(backendBaseUrl(), "https://api.example.test");
  } finally {
    if (previous === undefined) delete process.env.BACKEND_URL;
    else process.env.BACKEND_URL = previous;
  }
});

test("only the trusted Preview backend receives the runtime identity and redirects cannot forward it", async t => {
  const saved = { ...process.env };
  t.after(() => { for (const name of ["BACKEND_URL", "BACKEND_ENVIRONMENT", "VERCEL_ENV", "VERCEL_OIDC_TOKEN"]) {
    if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name];
  } });
  const base = "https://scope-flow-backend-git-codex-preview-yakchat-s-projects.vercel.app";
  Object.assign(process.env, { BACKEND_URL: base, BACKEND_ENVIRONMENT: "preview", VERCEL_ENV: "preview", VERCEL_OIDC_TOKEN: "fixture-project-token" });
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json(null));
  const input = { headers: { cookie: "_vercel_jwt=fixture; app=session", "x-vercel-trusted-oidc-idp-token": "caller" }, redirect: "follow" as const };
  await backendFetch("/api/health", input);
  const [, init] = fetch.mock.calls[0].arguments as unknown as [string, RequestInit];
  assert.equal(init.redirect, "error");
  assert.equal(new Headers(init.headers).get("cookie"), "app=session");
  assert.equal(new Headers(init.headers).get("x-vercel-trusted-oidc-idp-token"), "fixture-project-token");
  process.env.BACKEND_URL = "https://another.example.invalid";
  assert.throws(() => backendFetch("/api/health", input), /Preview/);
  assert.throws(() => backendFetch("//another.example.invalid", input), /API path/);
  process.env.BACKEND_ENVIRONMENT = process.env.VERCEL_ENV = "production";
  await backendFetch("/api/health", input);
  const [, production] = fetch.mock.calls[1].arguments as unknown as [string, RequestInit];
  assert.equal(new Headers(production.headers).has("x-vercel-trusted-oidc-idp-token"), false);
});
