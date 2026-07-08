/**
 * Frontend-only template: Vite + React + TypeScript + Tailwind v4 + shadcn/ui.
 *
 * No `server/`, no Hono, no database — the app lives entirely in the browser
 * (React state + localStorage). Used when a request is a static/client-side UI
 * with no backend needs. Composed from the shared scaffold steps so it stays in
 * lockstep with the other templates on the parts they share.
 *
 * Published to E2B as `vite-spa-app` (see templates/registry.ts).
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
  writeContext,
} from "./shared";

let t: TemplateBuilder = Template().fromBunImage("1.3").setWorkdir(APP);

t = scaffoldBase(t);
t = writeViteConfig(t, { proxyApi: false }); // no API to proxy to
t = writeTsconfig(t);
t = shadcnInit(t);
t = writeTheme(t);
t = writeAppShell(t);
t = writeContext(t, { hasServer: false, hasDb: false });

// Frontend-only: just the Vite dev server. Ready when its port is listening.
export const template = t.setStartCmd("bunx vite --host", waitForPort(5173));
