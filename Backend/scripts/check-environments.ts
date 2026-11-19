import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { checkEnvironmentSeparation } from "../src/lib/deployment-environment";

const [development, preview, production] = process.argv.slice(2);
if (!development || !preview || !production) throw new Error("Supply three ignored env files in development, preview, production order. Values must be resolved literals.");
try {
  const configs = { development: parseEnv(readFileSync(development, "utf8")), preview: parseEnv(readFileSync(preview, "utf8")), production: parseEnv(readFileSync(production, "utf8")) };
  console.log(JSON.stringify(checkEnvironmentSeparation(configs)));
} catch (error) {
  const message = error instanceof Error && error.message.startsWith("Environment isolation check failed:") ? error.message : "Environment audit failed; check file access and resolved configuration. No values were logged.";
  console.error(message); process.exitCode = 1;
}
