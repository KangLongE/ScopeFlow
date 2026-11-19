import assert from "node:assert/strict";
import test from "node:test";
import { checkEnvironmentSeparation, deploymentEnvironment, migrationDatabaseUrl, validateDatabaseEnvironment, validateDeploymentEnvironment } from "@/lib/deployment-environment";

const configuration = (environment: string) => ({ SCOPEFLOW_ENV: environment, DATABASE_ENVIRONMENT: environment, DATABASE_URL: `postgresql://${environment}:password-${environment}@db-${environment}.example.invalid/app?sslmode=require`, BETTER_AUTH_SECRET: `unique-auth-secret-for-${environment}-${"x".repeat(32)}`, GROQ_API_KEY: `private-ai-key-${environment}`, BETTER_AUTH_URL: "https://api.example.invalid", FRONTEND_URL: "https://app.example.invalid" });
test("migration credentials can differ but the database, environment, TLS and schema must match runtime", () => {
  const values = configuration("production");
  assert.equal(migrationDatabaseUrl(values), values.DATABASE_URL);
  const owner = values.DATABASE_URL.replace("production:password-production", "migrator:private-migration-password");
  assert.equal(migrationDatabaseUrl({ ...values, DATABASE_URL: values.DATABASE_URL.replace("db-production.", "db-production-pooler."), MIGRATION_DATABASE_URL: owner }), owner);
  for (const wrong of [owner.replace("/app?", "/other?"), owner.replace("db-production.", "db-preview."), `${owner}&schema=other`]) {
    assert.throws(() => migrationDatabaseUrl({ ...values, MIGRATION_DATABASE_URL: wrong }), /MIGRATION_DATABASE_TARGET_MISMATCH/);
  }
  assert.throws(() => migrationDatabaseUrl({ ...values, MIGRATION_DATABASE_URL: owner.replace("sslmode=require", "sslmode=disable") }), /DATABASE_TLS_REQUIRED/);
  assert.throws(() => migrationDatabaseUrl({ ...values, DATABASE_ENVIRONMENT: "preview", MIGRATION_DATABASE_URL: owner }), /DATABASE_ENVIRONMENT_MISMATCH/);
});
test("database tools validate their target without requiring application URLs or AI credentials", () => {
  const values = { DATABASE_URL: configuration("preview").DATABASE_URL, SCOPEFLOW_ENV: "preview", DATABASE_ENVIRONMENT: "preview", FRONTEND_URL: "http://localhost:3000" };
  assert.equal(validateDatabaseEnvironment(values), "preview");
  assert.throws(() => validateDeploymentEnvironment(values), /SERVICE_HTTPS_REQUIRED/);
  assert.throws(() => validateDatabaseEnvironment({ ...values, DATABASE_ENVIRONMENT: "production" }), /DATABASE_ENVIRONMENT_MISMATCH/);
});
test("deployment identity is separate from a local production build and cannot override Vercel", () => {
  assert.equal(deploymentEnvironment({ NODE_ENV: "production" }), "development");
  assert.equal(validateDeploymentEnvironment({ DATABASE_URL: "postgresql://localhost/test" }), "development");
  assert.throws(() => deploymentEnvironment({ VERCEL_ENV: "production", SCOPEFLOW_ENV: "development" }), /DEPLOYMENT_ENVIRONMENT_MISMATCH/);
  assert.throws(() => validateDeploymentEnvironment({ ...configuration("production"), DATABASE_ENVIRONMENT: "preview" }), /DATABASE_ENVIRONMENT_MISMATCH/);
});
test("remote databases need an explicit environment and TLS; deployment cookies cannot span shared hosts", () => {
  assert.throws(() => validateDeploymentEnvironment({ DATABASE_URL: configuration("production").DATABASE_URL }), /DATABASE_ENVIRONMENT_REQUIRED/);
  assert.throws(() => validateDeploymentEnvironment({ ...configuration("preview"), DATABASE_URL: "postgresql://user:private@db.invalid/app" }), /DATABASE_TLS_REQUIRED/);
  assert.throws(() => validateDeploymentEnvironment({ ...configuration("production"), COOKIE_DOMAIN: ".vercel.app" }), /UNSAFE_COOKIE_DOMAIN/);
  assert.throws(() => validateDeploymentEnvironment({ ...configuration("production"), NEXT_PUBLIC_GROQ_API_KEY: "private" }), /PUBLIC_SECRET_VARIABLE/);
  assert.equal(validateDeploymentEnvironment({ ...configuration("production"), COOKIE_DOMAIN: ".example.invalid" }), "production");
});
test("all environments must use different database targets, credentials, session secrets and AI keys", () => {
  const configs = { development: configuration("development"), preview: configuration("preview"), production: configuration("production") };
  assert.equal(checkEnvironmentSeparation(configs).isolated, true);
  for (const [key, error] of [["DATABASE_URL", "DATABASE_TARGET_REUSED"], ["BETTER_AUTH_SECRET", "AUTH_SECRET_REUSED"], ["GROQ_API_KEY", "AI_KEY_REUSED"]] as const) {
    const changed = structuredClone(configs); changed.preview[key] = configs.production[key];
    assert.throws(() => checkEnvironmentSeparation(changed), new RegExp(error));
  }
  const changed = structuredClone(configs);
  changed.preview.DATABASE_URL = configs.production.DATABASE_URL.replace("db-production", "db-preview");
  assert.throws(() => checkEnvironmentSeparation(changed), /DATABASE_CREDENTIALS_REUSED/);
  const pooled = structuredClone(configs);
  pooled.preview.DATABASE_URL = configs.production.DATABASE_URL.replace("db-production.", "db-production-pooler.");
  assert.throws(() => checkEnvironmentSeparation(pooled), /DATABASE_TARGET_REUSED/);
});
test("environment failures do not include passwords or secret values", () => {
  assert.throws(() => validateDeploymentEnvironment({ ...configuration("preview"), DATABASE_URL: "postgresql://user:must-never-appear@db.invalid/app" }), error => error instanceof Error && !error.message.includes("must-never-appear"));
});
