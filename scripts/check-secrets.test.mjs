import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, unlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("secret guard checks staged content and reports locations without credential values", () => {
  const directory = mkdtempSync(join(tmpdir(), "scopeflow-secret-check-"));
  const scanner = fileURLToPath(new URL("check-secrets.mjs", import.meta.url));
  const run = (...args) => spawnSync(process.execPath, [scanner, ...args], { cwd: directory, encoding: "utf8", windowsHide: true });
  const git = (...args) => execFileSync("git", args, { cwd: directory, windowsHide: true, stdio: "ignore" });
  try {
    git("init");
    writeFileSync(join(directory, "safe.txt"), "ordinary source"); git("add", "safe.txt");
    assert.equal(run().status, 0);
    writeFileSync(join(directory, ".env.local"), "DATABASE_URL=placeholder");
    const privateFile = run(); assert.equal(privateFile.status, 1); assert.match(privateFile.stderr, /private-file/);
    unlinkSync(join(directory, ".env.local"));
    const credential = "gsk_" + "x".repeat(48);
    writeFileSync(join(directory, "credential.ts"), `export const key=${JSON.stringify(credential)};`); git("add", "credential.ts");
    writeFileSync(join(directory, "credential.ts"), "removed from working copy");
    const staged = run("--staged");
    assert.equal(staged.status, 1); assert.match(staged.stderr, /provider-credential/); assert.ok(!staged.stderr.includes(credential));
    const authSecret = "Z".repeat(48);
    writeFileSync(join(directory, "settings.md"), `BETTER_AUTH_SECRET="${authSecret}"`); git("add", "settings.md");
    const auth = run("--staged"); assert.equal(auth.status, 1); assert.match(auth.stderr, /environment-secret/); assert.ok(!auth.stderr.includes(authSecret));
  } finally {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith("scopeflow-secret-check-")) throw new Error("Unexpected test cleanup target");
    rmSync(directory, { recursive: true, force: true });
  }
});
