export function trustedOrigins(frontendUrl: string) {
  const frontend = new URL(frontendUrl);
  const origins = [frontend.origin];
  if (frontend.hostname === "localhost") origins.push(`${frontend.protocol}//127.0.0.1${frontend.port ? `:${frontend.port}` : ""}`);
  if (frontend.hostname === "127.0.0.1") origins.push(`${frontend.protocol}//localhost${frontend.port ? `:${frontend.port}` : ""}`);
  return origins;
}
