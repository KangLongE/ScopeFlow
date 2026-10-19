export function scopeIntegrations(existing: string[], requirements: readonly unknown[]) {
  const result = [...existing];
  const key = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();
  for (const raw of requirements) {
    if (!raw || typeof raw !== "object") continue;
    const requirement = raw as { title?: unknown; type?: unknown; implementation?: { featureTypes?: unknown } | null };
    if (typeof requirement.title !== "string" || !requirement.title.trim()) continue;
    if (requirement.type !== "EXTERNAL_INTEGRATION" && !(Array.isArray(requirement.implementation?.featureTypes) && requirement.implementation.featureTypes.includes("EXTERNAL_INTEGRATION"))) continue;
    const title = requirement.title;
    if (!result.some(text => key(text) === key(title))) result.push(title);
  }
  return result;
}
