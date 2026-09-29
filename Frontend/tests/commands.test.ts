import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../src/app/api/commands/route";

test("commands use the displayed membership when the workspace cookie is absent or stale", async () => {
  const originalFetch = globalThis.fetch;
  let selected = "";
  globalThis.fetch = async (input, init) => {
    if (String(input).endsWith("/workspaces")) return Response.json([{ id: "first" }, { id: "second" }]);
    selected = new Headers(init?.headers).get("x-workspace-id") ?? "";
    return Response.json({ message: "saved" });
  };
  try {
    for (const [cookie, expected] of [["", "first"], ["stale", "first"], ["second", "second"]]) {
      const response = await POST(new NextRequest("http://localhost/api/commands", {
        method: "POST", headers: { cookie: `scopeflow-workspace=${cookie}` }, body: JSON.stringify({ action: "client.create" }),
      }));
      assert.equal(response.status, 200);
      assert.equal(selected, expected);
      assert.equal(response.cookies.get("scopeflow-workspace")?.value, expected);
    }
    assert.equal((await POST(new NextRequest("http://localhost/api/commands", { method: "POST", body: "null" }))).status, 422);
  } finally { globalThis.fetch = originalFetch; }
});
