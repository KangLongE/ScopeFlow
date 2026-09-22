import { betterAuth } from "better-auth";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { prisma } from "@/lib/db/prisma";
import { getEnv } from "@/lib/env";

const env = getEnv();
const frontend = new URL(env.FRONTEND_URL);
const trustedOrigins = [env.FRONTEND_URL];
if (frontend.hostname === "localhost") trustedOrigins.push(`${frontend.protocol}//127.0.0.1${frontend.port ? `:${frontend.port}` : ""}`);
if (frontend.hostname === "127.0.0.1") trustedOrigins.push(`${frontend.protocol}//localhost${frontend.port ? `:${frontend.port}` : ""}`);

export const auth = betterAuth({
  appName: "ScopeFlow",
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: prismaAdapter(prisma, { provider: "postgresql", transaction: true }),
  trustedOrigins,
  emailAndPassword: { enabled: true, minPasswordLength: 10 },
  session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
  rateLimit: { enabled: true, storage: "database", window: 60, max: 20 },
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
