import { createHash } from "node:crypto";

type Values = Record<string, string | undefined>;
export type DeploymentEnvironment = "development" | "preview" | "production" | "test";
const environments = new Set(["development", "preview", "production", "test"]);
const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
const fail = (code: string): never => { throw new Error(`Environment isolation check failed: ${code}`); };

export function deploymentEnvironment(values: Values): DeploymentEnvironment {
  const environment = values.VERCEL_ENV ?? values.SCOPEFLOW_ENV ?? "development";
  if (!environments.has(environment)) fail("UNKNOWN_ENVIRONMENT");
  if (values.VERCEL_ENV && values.SCOPEFLOW_ENV && values.VERCEL_ENV !== values.SCOPEFLOW_ENV) fail("DEPLOYMENT_ENVIRONMENT_MISMATCH");
  return environment as DeploymentEnvironment;
}

export function validateDatabaseEnvironment(values: Values) {
  const environment = deploymentEnvironment(values);
  let database: URL;
  try { database = new URL(values.DATABASE_URL ?? ""); } catch { return fail("INVALID_DATABASE_URL"); }
  if (!["postgres:", "postgresql:"].includes(database.protocol)) fail("INVALID_DATABASE_PROTOCOL");
  const local = localHosts.has(database.hostname);
  const declared = values.DATABASE_ENVIRONMENT;
  if (declared && declared !== environment) fail("DATABASE_ENVIRONMENT_MISMATCH");
  if ((!local || values.VERCEL_ENV) && !declared) fail("DATABASE_ENVIRONMENT_REQUIRED");
  if (["preview", "production"].includes(environment) && local) fail("DEPLOYED_DATABASE_IS_LOCAL");
  if (!local && !["require", "verify-full", "verify-ca"].includes(database.searchParams.get("sslmode") ?? "")) fail("DATABASE_TLS_REQUIRED");
  return environment;
}

export function migrationDatabaseUrl(values: Values) {
  validateDatabaseEnvironment(values);
  const migrationUrl = values.MIGRATION_DATABASE_URL ?? values.DATABASE_URL!;
  validateDatabaseEnvironment({ ...values, DATABASE_URL: migrationUrl });
  const targets = [values.DATABASE_URL!, migrationUrl].map(value => {
    const url = new URL(value);
    return `${url.hostname.replace(/-pooler(?=\.)/, "")}:${url.port || "5432"}${url.pathname}?schema=${url.searchParams.get("schema") || "public"}`;
  });
  if (targets[0] !== targets[1]) fail("MIGRATION_DATABASE_TARGET_MISMATCH");
  return migrationUrl;
}

export function validateDeploymentEnvironment(values: Values) {
  const environment = validateDatabaseEnvironment(values);
  for (const key of Object.keys(values)) if (/^NEXT_PUBLIC_.*(SECRET|PASSWORD|PRIVATE|DATABASE|API_KEY)/i.test(key) && values[key]) fail("PUBLIC_SECRET_VARIABLE");
  if (["preview", "production"].includes(environment)) {
    for (const key of ["BETTER_AUTH_URL", "FRONTEND_URL"]) if (values[key]) {
      let url: URL;
      try { url = new URL(values[key]!); } catch { return fail("INVALID_SERVICE_URL"); }
      if (url.protocol !== "https:" || url.username || url.password) fail("SERVICE_HTTPS_REQUIRED");
    }
    if (values.BETTER_AUTH_SECRET && /test-only|change.?me|replace.?me|example/i.test(values.BETTER_AUTH_SECRET)) fail("PLACEHOLDER_AUTH_SECRET");
  }
  if (values.COOKIE_DOMAIN) {
    const domain = values.COOKIE_DOMAIN.replace(/^\./, "").toLowerCase();
    if (["vercel.app", "neon.tech", "localhost"].includes(domain) || !domain.includes(".") || domain.includes("*")) fail("UNSAFE_COOKIE_DOMAIN");
    for (const key of ["FRONTEND_URL", "BETTER_AUTH_URL"]) if (values[key]) {
      const host = new URL(values[key]!).hostname;
      if (host !== domain && !host.endsWith(`.${domain}`)) fail("COOKIE_DOMAIN_MISMATCH");
    }
  }
  return environment;
}

export function checkEnvironmentSeparation(configs: Record<"development" | "preview" | "production", Values>) {
  const targets = new Set<string>(), credentials = new Set<string>(), authSecrets = new Set<string>(), aiKeys = new Set<string>();
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  for (const environment of ["development", "preview", "production"] as const) {
    const values = configs[environment];
    if (validateDeploymentEnvironment({ ...values, SCOPEFLOW_ENV: environment }) !== environment) fail("AUDIT_ENVIRONMENT_MISMATCH");
    const authSecret = values.BETTER_AUTH_SECRET, aiKey = values.GROQ_API_KEY;
    if (!authSecret || authSecret.length < 32 || !aiKey) return fail("MISSING_ENVIRONMENT_SECRET");
    const url = new URL(values.DATABASE_URL!);
    const target = hash(`${url.hostname.replace(/-pooler(?=\.)/, "")}:${url.port || "5432"}${url.pathname}`);
    const credential = hash(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`);
    const auth = hash(authSecret), ai = hash(aiKey);
    if (targets.has(target)) fail("DATABASE_TARGET_REUSED");
    if (credentials.has(credential)) fail("DATABASE_CREDENTIALS_REUSED");
    if (authSecrets.has(auth)) fail("AUTH_SECRET_REUSED");
    if (aiKeys.has(ai)) fail("AI_KEY_REUSED");
    targets.add(target); credentials.add(credential); authSecrets.add(auth); aiKeys.add(ai);
  }
  return { checkedEnvironments: ["development", "preview", "production"], isolated: true };
}
