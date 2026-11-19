import { betterAuth } from "better-auth";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { prisma } from "@/lib/db/prisma";
import { getEnv } from "@/lib/env";
import { trustedOrigins } from "@/lib/origins";

const env = getEnv();

export const auth = betterAuth({
  appName: "ScopeFlow",
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: prismaAdapter(prisma, { provider: "postgresql", transaction: true }),
  trustedOrigins: trustedOrigins(env.FRONTEND_URL),
  emailAndPassword: { enabled: true, minPasswordLength: 10 },
  session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
  rateLimit: { enabled: true, storage: "database", window: 60, max: 20,
    // Session reads happen on every navigation; keep sign-in/write limits unchanged.
    customRules: { "/get-session": { window: 60, max: 120 } },
  },
  advanced: {
    useSecureCookies: env.BETTER_AUTH_URL.startsWith("https://"),
    crossSubDomainCookies: env.COOKIE_DOMAIN
      ? { enabled: true, domain: env.COOKIE_DOMAIN }
      : undefined,
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: env.BETTER_AUTH_URL.startsWith("https://") ? "none" : "lax",
      secure: env.BETTER_AUTH_URL.startsWith("https://"),
    },
  },
});
