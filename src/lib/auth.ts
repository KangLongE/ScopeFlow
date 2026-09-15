import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { db } from "./db";
import * as schema from "./db/schema";

function secret() {
  if (process.env.NEXT_PHASE === "phase-production-build") return randomBytes(48).toString("hex");
  if (process.env.BETTER_AUTH_SECRET) return process.env.BETTER_AUTH_SECRET;
  if (process.env.VERCEL || process.env.DATABASE_URL && process.env.NODE_ENV === "production") throw new Error("BETTER_AUTH_SECRET is required in production");
  const path = resolve(".data/auth-secret");
  try { return readFileSync(path, "utf8"); } catch {
    mkdirSync(resolve(".data"), { recursive: true });
    try { writeFileSync(path, randomBytes(48).toString("hex"), { flag: "wx", mode: 0o600 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    return readFileSync(path, "utf8");
  }
}
export const appUrl = process.env.BETTER_AUTH_URL || "http://localhost:3000";
export const auth = betterAuth({
  appName: "ScopeFlow", baseURL: appUrl, secret: secret(),
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: { enabled: true, minPasswordLength: 10, maxPasswordLength: 128 },
  session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
  rateLimit: { enabled: true, storage: "database", window: 60, max: 30 },
  trustedOrigins: [appUrl],
});
