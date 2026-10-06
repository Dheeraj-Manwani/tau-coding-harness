/**
 * The generation-2 base template: one image for every app.
 *
 * Vite + React + TypeScript + Tailwind v4 + shadcn/ui, frontend only. Where
 * generation 1 has three images and makes the agent pick one up front, this is
 * the only image there is — an app that later needs a server or a database gets
 * one added in place rather than by being rebuilt on a different image. So the
 * things that make that cheap are already here: the `/api` proxy is in
 * `vite.config.ts` from the start, and the backend and database packages are
 * sitting in Bun's install cache.
 *
 * Differences from `vite-react.ts`, all deliberate:
 *   - neutral palette instead of the Spotify one (still dark by default, which
 *     is what the theme panel in the web app assumes);
 *   - `.tau/CONTEXT.md` is app memory only, with no template manifest;
 *   - `/api` proxy present, backend/database packages pre-downloaded;
 *   - ripgrep installed.
 *
 * Composed from the shared scaffold steps. The generation-1 templates and the
 * helpers they call are left exactly as they are — production still boots from
 * those images. See doc/CONTEXT_AND_MEMORY_PLAN.md §6.
 *
 * Published to E2B as `tau-app-v2` (see templates/registry.ts).
 */
import { Template, waitForPort, type TemplateBuilder } from "e2b";
import {
  APP,
  scaffoldBase,
  writeViteConfig,
  writeTsconfig,
  shadcnInit,
  writeNeutralTheme,
  writeAppShell,
  writeAppMemory,
  writeVisualEdit,
  warmBackendPackages,
  installSearchTools,
} from "./shared";

let t: TemplateBuilder = Template().fromBunImage("1.3").setWorkdir(APP);

t = scaffoldBase(t);
t = writeViteConfig(t, { proxyApi: true }); // harmless with no server; saves an edit when one is added
t = writeVisualEdit(t); // .tau/tagger.ts + runtime.js for visual edit
t = writeTsconfig(t);
t = shadcnInit(t);
t = writeNeutralTheme(t);
t = writeAppShell(t);
t = writeAppMemory(t);
t = warmBackendPackages(t);
t = installSearchTools(t);

// Vite only. A server, when an app has one, is started by the harness — the
// image cannot know which apps will grow one.
export const template = t.setStartCmd("bunx vite --host", waitForPort(5173));
