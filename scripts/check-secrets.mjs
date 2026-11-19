import { execFileSync } from "node:child_process";
import { readFileSync, lstatSync } from "node:fs";

const staged = process.argv.includes("--staged");
const files = execFileSync("git", staged ? ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"] : ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8", windowsHide: true }).split("\0").filter(Boolean);
const findings = [];
for (const file of files) {
  if (/(^|\/)(\.env[^/]*|credentials[^/]*\.json|[^/]*service-account[^/]*\.json)$|\.(pem|key|p12|pfx|jks|sfbak|dump|backup|dpapi)$/i.test(file)) findings.push({ file, rule: "private-file" });
  if (/(^|\/)(\.vercel|\.data|\.codex|\.agents|backups|test-results)\/|(^|\/)(\.npmrc|\.netrc|\.pypirc)$/.test(file)) findings.push({ file, rule: "private-artifact" });
  let bytes;
  try {
    if (!staged && !lstatSync(file).isFile()) continue;
    bytes = staged ? execFileSync("git", ["show", `:${file}`], { windowsHide: true, maxBuffer: 32 * 1024 * 1024 }) : readFileSync(file);
  } catch { findings.push({ file, rule: "unreadable-file" }); continue; }
  if (bytes.includes(0)) continue;
  const contents = bytes.toString("utf8");
  if (/(?:gsk_[A-Za-z0-9]{24,}|ghp_[A-Za-z0-9]{24,}|github_pat_[A-Za-z0-9_]{24,}|sk-(?:proj-)?[A-Za-z0-9_-]{32,})/.test(contents)) findings.push({ file, rule: "provider-credential" });
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(contents)) findings.push({ file, rule: "private-key" });
  for (const match of contents.matchAll(/\b(?:BETTER_AUTH_SECRET|GROQ_API_KEY|BACKUP_ENCRYPTION_KEY)\s*[:=]\s*["'`]([^"'`\r\n]+)["'`]/g)) {
    const value = match[1];
    if (value.length >= 32 && !value.includes("${") && !/test-only|fixture|placeholder|replace.?me|example|^<.*>$|x{12}/i.test(value)) findings.push({ file, rule: "environment-secret" });
  }
  for (const match of contents.matchAll(/postgres(?:ql)?:\/\/([^:\s/]+):([^@\s]+)@([^/\s'"`]+)/g)) {
    if (match[0].includes("${") || /(?:^|\.)(?:invalid|example\.com)(?::\d+)?$/.test(match[3]) || /^<.*>$/.test(match[2]) || /^(?:test(?:-only)?|postgres|password|scopeflow)$/.test(match[2])) continue;
    findings.push({ file, rule: "database-password" });
  }
}
if (findings.length) { console.error(JSON.stringify({ passed: false, findings }, null, 2)); process.exitCode = 1; }
else console.log(JSON.stringify({ passed: true, scannedFiles: files.length, secretValuesLogged: false }));
