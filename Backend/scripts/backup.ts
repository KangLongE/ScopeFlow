import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import nextEnv from "@next/env";
import { Pool } from "pg";
import { encryptBackup, decryptBackup } from "../src/lib/backup-crypto";
import { validateDatabaseEnvironment } from "../src/lib/deployment-environment";

nextEnv.loadEnvConfig(process.cwd());
const [mode, file] = process.argv.slice(2);
const secret = process.env.BACKUP_ENCRYPTION_KEY;
if (!secret) throw new Error("Set BACKUP_ENCRYPTION_KEY using your secret manager; do not put it in command arguments");
const maxBytes = 256_000_000;
function connection(value: string | undefined) {
  let url: URL;
  try { url = new URL(value ?? ""); } catch { throw new Error("A PostgreSQL connection is required"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("PostgreSQL connection required");
  return { url, env: { ...process.env, PGHOST: url.hostname, PGPORT: url.port || "5432", PGDATABASE: decodeURIComponent(url.pathname.slice(1)), PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGSSLMODE: url.searchParams.get("sslmode") ?? "prefer" } };
}
function run(binary: string, args: string[], env: NodeJS.ProcessEnv, input?: Buffer) {
  const result = spawnSync(binary, args, { env, input, maxBuffer: maxBytes, windowsHide: true });
  if (result.error || result.status !== 0) throw new Error("PostgreSQL backup tool failed. Check its installation, credentials, version and the 256 MB offline limit; no connection details were logged.");
  return result.stdout;
}
if (mode === "create") {
  validateDatabaseEnvironment(process.env);
  const source = connection(process.env.DATABASE_URL);
  // Excluding the managed schema preserves pg_dump's handling of the pre-existing public schema on restore.
  const plain = run(process.env.PG_DUMP_PATH || "pg_dump", ["--format=custom", "--exclude-schema=neon_auth", "--no-owner", "--no-privileges"], source.env);
  let encrypted: Buffer;
  try { encrypted = encryptBackup(plain, secret); } finally { plain.fill(0); }
  const directory = resolve("backups"); mkdirSync(directory, { recursive: true, mode: 0o700 });
  const target = resolve(directory, `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.sfbak`);
  writeFileSync(target, encrypted, { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ backup: target, excludedSchemas: ["neon_auth"], encrypted: true, bytes: encrypted.length, plaintextWritten: false }));
} else if (mode === "verify" || mode === "restore") {
  if (!file) throw new Error("Supply the encrypted backup filename");
  if (statSync(resolve(file)).size > maxBytes) throw new Error("Archive exceeds the offline restore limit");
  const archive = readFileSync(resolve(file));
  const plain = decryptBackup(archive, secret);
  try {
    if (mode === "verify") {
      // Rendering into the null device also checks table-data blocks, without persisting SQL.
      run(process.env.PG_RESTORE_PATH || "pg_restore", ["--exit-on-error", "--file", process.platform === "win32" ? "NUL" : "/dev/null"], process.env, plain);
    } else {
      const target = connection(process.env.RESTORE_DATABASE_URL);
      if (!["localhost", "127.0.0.1", "[::1]"].includes(target.url.hostname)) throw new Error("This recovery drill only restores into a local empty database");
      const source = process.env.DATABASE_URL ? connection(process.env.DATABASE_URL).url : null;
      if (source && source.hostname === target.url.hostname && source.port === target.url.port && source.pathname === target.url.pathname) throw new Error("Restore target must differ from the source database");
      const pool = new Pool({ connectionString: process.env.RESTORE_DATABASE_URL });
      try {
        const { rows } = await pool.query("SELECT count(*)::int AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'");
        if (rows[0].count !== 0) throw new Error("Restore target is not empty; existing databases are never overwritten");
        run(process.env.PG_RESTORE_PATH || "pg_restore", ["--exit-on-error", "--single-transaction", "--no-owner", "--no-privileges", "--dbname", target.env.PGDATABASE], target.env, plain);
      } finally { await pool.end(); }
    }
    console.log(JSON.stringify({ authenticated: true, archiveVerified: true, restored: mode === "restore", plaintextWritten: false }));
  } finally { plain.fill(0); }
} else throw new Error("Use create, verify, or restore. Restore is restricted to a local empty recovery database.");
