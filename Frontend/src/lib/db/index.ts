import { PGlite } from "@electric-sql/pglite";
import { drizzle as pgliteDrizzle } from "drizzle-orm/pglite";
import { drizzle as pgDrizzle } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import { resolve, dirname } from "node:path";
import { mkdirSync } from "node:fs";
import * as schema from "./schema";

type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
const globals = globalThis as unknown as { scopeflowDb?: Database; scopeflowPg?: Pool; scopeflowLite?: PGlite };

function connect(): Database {
  // Build workers inspect route modules without querying data. Do not open a local data directory there.
  const building = process.env.NEXT_PHASE === "phase-production-build";
  if (process.env.DATABASE_URL || building) {
    globals.scopeflowPg = new Pool({ connectionString: building ? undefined : process.env.DATABASE_URL, max: 5 });
    return pgDrizzle(globals.scopeflowPg, { schema });
  }
  if (process.env.VERCEL) throw new Error("DATABASE_URL is required on Vercel");
  // ponytail: embedded PostgreSQL is single-process; use DATABASE_URL for multiple workers.
  const path = process.env.PGLITE_PATH || resolve(".data/postgres");
  if (path !== "memory://") mkdirSync(dirname(path), { recursive: true });
  globals.scopeflowLite = new PGlite(path);
  return pgliteDrizzle(globals.scopeflowLite, { schema });
}
export const db = globals.scopeflowDb ??= connect();
export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export async function closeDatabase() {
  await globals.scopeflowLite?.close();
  await globals.scopeflowPg?.end();
}
