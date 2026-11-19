import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET } from "../src/app/api/workspace-export/route";

test("export proxy refuses cross-site downloads and preserves backend authentication failures", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ error: { code: "UNAUTHENTICATED", message: "로그인이 필요합니다." } }, { status: 401 }); };
  try {
    const foreign = await GET(new NextRequest("http://localhost:3000/api/workspace-export", { headers: { "sec-fetch-site": "cross-site" } }));
    assert.equal(foreign.status, 403); assert.equal(calls, 0);
    const anonymous = await GET(new NextRequest("http://localhost:3000/api/workspace-export"));
    assert.equal(anonymous.status, 401); assert.equal(anonymous.headers.has("content-disposition"), false);
  } finally { globalThis.fetch = original; }
});
test("export proxy uses an owned membership instead of a forged workspace cookie and disables caching", async () => {
  const original = globalThis.fetch;
  const workspace = "00000000-0000-4000-8000-000000000001";
  const paths: string[] = [];
  globalThis.fetch = async (input, options) => {
    const path = new URL(String(input)).pathname; paths.push(path);
    if (path === "/api/v1/workspaces") return Response.json([{ id: workspace }]);
    assert.equal(new Headers(options?.headers).get("x-workspace-id"), workspace);
    assert.equal(path, `/api/v1/workspaces/${workspace}/export`);
    return Response.json({ schemaVersion: 1, workspace: { id: workspace }, projects: [] });
  };
  try {
    const response = await GET(new NextRequest("http://localhost:3000/api/workspace-export", { headers: { cookie: "scopeflow-workspace=foreign-workspace" } }));
    assert.equal(response.status, 200); assert.match(response.headers.get("content-disposition")!, /attachment/);
    assert.match(response.headers.get("cache-control")!, /private, no-store/);
    assert.equal((await response.json()).workspace.id, workspace); assert.equal(paths.length, 2);
  } finally { globalThis.fetch = original; }
});
