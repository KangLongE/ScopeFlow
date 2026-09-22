import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1).refine(value => value.startsWith("postgresql://") || value.startsWith("postgres://"), "DATABASE_URL must be PostgreSQL"),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
  FRONTEND_URL: z.url(),
  COOKIE_DOMAIN: z.string().trim().optional().transform(value => value || undefined),
  GROQ_API_KEY: z.string().min(1),
  AI_PROVIDER: z.literal("groq").default("groq"),
  AI_FAST_MODEL: z.string().min(1).default("openai/gpt-oss-20b"),
  AI_STANDARD_MODEL: z.string().min(1).default("openai/gpt-oss-120b"),
  AI_REASONING_MODEL: z.string().min(1).default("openai/gpt-oss-120b"),
  AI_MODEL_PRICES: z.string().refine(value => { try { return typeof JSON.parse(value) === "object"; } catch { return false; } }, "AI_MODEL_PRICES must be JSON").default("{}"),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(90000).default(45000),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(512).max(12000).default(6000),
});

let cached: z.infer<typeof schema> | undefined;
export function env() { return cached ??= schema.parse(process.env); }
export const getEnv = env;
export function validateEnv() { env(); }
