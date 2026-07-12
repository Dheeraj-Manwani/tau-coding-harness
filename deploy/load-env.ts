import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Populate process.env from deploy/.env BEFORE any service env.ts runs (each
 * validates at import time and process.exit(1)s on a missing var). Dependency-
 * free so it works from the repo root without dotenv.
 *
 * Local dev only: in Docker/Render the environment is already injected
 * (`docker run --env-file` / platform env vars), so a missing file is fine and
 * existing process.env values always win.
 */
const envPath = resolve(import.meta.dir, ".env");

if (existsSync(envPath)) {
  const text = readFileSync(envPath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
  console.log(`[economy] loaded env from ${envPath}`);
}
