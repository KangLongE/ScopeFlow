import assert from "node:assert/strict";
import test from "node:test";
import { backendBaseUrl, BackendError } from "../src/lib/api";
import { validateFrontendEnvironment } from "../src/lib/environment";

test("frontend compilation refuses backend credentials and public secret variables", () => {
  for (const key of ["DATABASE_URL", "MIGRATION_DATABASE_URL", "DATABASE_URL_UNPOOLED", "POSTGRES_URL_NON_POOLING", "POSTGRES_PRISMA_URL", "PGPASSWORD", "POSTGRES_PASSWORD", "GROQ_API_KEY", "BETTER_AUTH_SECRET", "BACKUP_ENCRYPTION_KEY", "NEXT_PUBLIC_GROQ_API_KEY", "NEXT_PUBLIC_AUTH_SECRET"]) {
    assert.throws(() => validateFrontendEnvironment({ [key]: "never-display-this-value" }), error => error instanceof Error && !error.message.includes("never-display-this-value"));
  }
  assert.doesNotThrow(() => validateFrontendEnvironment({ BACKEND_URL: "https://api.example.invalid", BACKEND_ENVIRONMENT: "preview", NEXT_PUBLIC_BRAND_NAME: "ScopeFlow" }));
});

test("preview cannot silently use a production-tagged backend and deployed connections need HTTPS", () => {
  const saved = { VERCEL_ENV: process.env.VERCEL_ENV, BACKEND_ENVIRONMENT: process.env.BACKEND_ENVIRONMENT, BACKEND_URL: process.env.BACKEND_URL };
  try {
    process.env.VERCEL_ENV = "preview"; process.env.BACKEND_ENVIRONMENT = "production"; process.env.BACKEND_URL = "https://api.example.invalid";
    assert.throws(() => backendBaseUrl(), error => error instanceof BackendError && error.code === "BACKEND_ENVIRONMENT_MISMATCH");
    process.env.BACKEND_ENVIRONMENT = "preview";
    assert.equal(backendBaseUrl(), "https://api.example.invalid");
    process.env.BACKEND_URL = "http://127.0.0.1:3001";
    assert.throws(() => backendBaseUrl(), /배포 환경/);
  } finally { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});
