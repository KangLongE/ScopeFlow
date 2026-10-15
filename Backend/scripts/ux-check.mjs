// Isolated, disposable database for the UX audit; never migrates the configured database.
import nextEnv from "@next/env";
import { Client } from "pg";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";

nextEnv.loadEnvConfig(process.cwd());
const database = "scopeflow_ux_20260928";
const source = new URL(process.env.DATABASE_URL);
if (!["localhost", "127.0.0.1", "[::1]"].includes(source.hostname)) throw new Error("Only a local PostgreSQL server is allowed for disposable checks.");
const isolated = new URL(source);
isolated.pathname = "/" + database;
const mode = process.argv[2];
if (!["init", "test", "quality", "serve", "clean"].includes(mode)) throw new Error("Use init, test, quality, serve or clean");
if (mode === "init" || mode === "clean") {
  const admin = new Client({ connectionString: source.toString() });
  await admin.connect();
  try {
    const exists = (await admin.query("SELECT datname FROM pg_database WHERE datname=$1", [database])).rowCount;
    if (mode === "init") {
      if (exists) throw new Error("Isolated database already exists; do not overwrite it.");
      await admin.query('CREATE DATABASE "' + database + '"');
    } else if (exists) {
      // Exact fixed test database only; pooled idle connections can outlive the server.
      const active = await admin.query("SELECT 1 FROM pg_stat_activity WHERE datname=$1 AND state IS DISTINCT FROM 'idle'", [database]);
      if (active.rowCount) throw new Error("Stop active UX database work before cleaning.");
      await admin.query('DROP DATABASE "' + database + '" WITH (FORCE)');
    }
  } finally { await admin.end(); }
  if (mode === "init") {
    const db = new Client({ connectionString: isolated.toString() });
    await db.connect();
    try {
      for (const migration of ["0001_init", "0002_workflow_review", "0003_ai_context", "0004_ai_rule_validation", "0005_change_approval_impact", "0006_credit_errors_ux"]) await db.query(readFileSync(new URL("../prisma/migrations/" + migration + "/migration.sql", import.meta.url), "utf8"));
    } finally { await db.end(); }
  }
  console.log(mode === "init" ? "Isolated UX database ready." : "Isolated UX database removed.");
} else {
  const args = mode === "test" ? ["--import", "tsx", "--test", "tests/integration.test.ts", "tests/context.test.ts", "tests/validator-integration.test.ts", "tests/impact-integration.test.ts", "tests/credit-integration.test.ts", "tests/exclusions-integration.test.ts"] : mode === "quality" ? ["--import", "tsx", "scripts/context-quality-check.ts"] : ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", "3101"];
  const child = spawn(process.execPath, [...args, ...process.argv.slice(3)], { stdio: "inherit", env: { ...process.env, DATABASE_URL: isolated.toString(), TEST_DATABASE_URL: isolated.toString(), BETTER_AUTH_URL: "http://localhost:3101", FRONTEND_URL: "http://localhost:3100", COOKIE_DOMAIN: "" } });
  child.on("exit", code => { process.exitCode = code ?? 1; });
}
