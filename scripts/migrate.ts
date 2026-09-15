import { readMigrationFiles } from "drizzle-orm/migrator";
import { sql } from "drizzle-orm";
import { db, closeDatabase } from "../src/lib/db/index";

// Read Drizzle's versioned migrations and apply each batch atomically on either PostgreSQL driver.
const migrations = readMigrationFiles({ migrationsFolder: "drizzle" });
await db.execute(sql`CREATE TABLE IF NOT EXISTS scopeflow_migrations (hash text PRIMARY KEY, created_at bigint NOT NULL)`);
for (const migration of migrations) {
  await db.transaction(async tx => {
    await tx.execute(sql`LOCK TABLE scopeflow_migrations IN EXCLUSIVE MODE`);
    const result = await tx.execute(sql`SELECT hash FROM scopeflow_migrations WHERE hash = ${migration.hash}`);
    if ((result as { rows: unknown[] }).rows.length) return;
    for (const statement of migration.sql) await tx.execute(sql.raw(statement));
    await tx.execute(sql`INSERT INTO scopeflow_migrations(hash, created_at) VALUES (${migration.hash}, ${migration.folderMillis})`);
  });
}
console.log(`Database ready: ${migrations.length} versioned migrations applied.`);
await closeDatabase();
