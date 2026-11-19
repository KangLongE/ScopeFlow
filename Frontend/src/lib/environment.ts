export function validateFrontendEnvironment(values: Record<string, string | undefined>) {
  for (const [name, value] of Object.entries(values)) {
    if (!value) continue;
    if (/^NEXT_PUBLIC_.*(SECRET|PASSWORD|PRIVATE|DATABASE|API_KEY)/i.test(name)) throw new Error("Frontend configuration rejected: PUBLIC_SECRET_VARIABLE");
    const databaseSecret = /(^|_)DATABASE_URL($|_)/.test(name) || /^(POSTGRES_(URL.*|PRISMA_URL|PASSWORD)|PGPASSWORD)$/.test(name);
    if (databaseSecret || ["BETTER_AUTH_SECRET", "GROQ_API_KEY", "BACKUP_ENCRYPTION_KEY"].includes(name)) throw new Error("Frontend configuration rejected: BACKEND_SECRET_IN_FRONTEND");
  }
}
