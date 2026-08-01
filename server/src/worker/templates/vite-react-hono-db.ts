/**
 * Full-stack + database template: Vite + React + shadcn/ui frontend, Hono API
 * on Bun, and a PGlite (Postgres in WASM) + Drizzle database **pre-installed
 * and wired** (server/db/{schema,client,validation}.ts, initDb() called at
 * startup, a worked CRUD example in server/index.ts).
 *
 * Used when a request genuinely needs persistence / a real backend — multi-user
 * data, auth, server-side logic — so the agent doesn't have to scaffold the DB
 * from the recipe on every build. Composed from the shared scaffold steps.
 *
 * Published to E2B as `vite-hono-db-app` (see templates/registry.ts).
 */
import { Template, waitForPort, type TemplateBuilder } from "e2b";
import {
  APP,
  scaffoldBase,
  writeViteConfig,
  writeTsconfig,
  shadcnInit,
  writeTheme,
  writeAppShell,
  writeHonoApi,
  writeDbStack,
  writeContext,
  writeVisualEdit,
} from "./shared";

let t: TemplateBuilder = Template().fromBunImage("1.3").setWorkdir(APP);

t = scaffoldBase(t);
t = writeViteConfig(t, { proxyApi: true }); // forward /api/* to Hono on :3000
t = writeVisualEdit(t); // .tau/tagger.ts + runtime.js for visual edit
t = writeTsconfig(t);
t = shadcnInit(t);
t = writeTheme(t);
t = writeAppShell(t);
t = writeHonoApi(t); // base Hono app + example routes …
t = writeDbStack(t); // … then rewrite server/index.ts with the DB wiring
t = writeContext(t, { hasServer: true, hasDb: true });

// Start the API in the background, Vite in the foreground. Ready when Vite's
// port is listening — more reliable than polling `/` for a 200.
export const template = t.setStartCmd(
  "bun --watch server/index.ts & bunx vite --host",
  waitForPort(5173),
);
