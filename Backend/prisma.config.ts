import { loadEnvConfig } from "@next/env";
import { defineConfig } from "prisma/config";
import { migrationDatabaseUrl } from "./src/lib/deployment-environment";

loadEnvConfig(process.cwd());
const databaseUrl = migrationDatabaseUrl(process.env);

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "tsx prisma/seed.ts" },
  datasource: { url: databaseUrl },
});
