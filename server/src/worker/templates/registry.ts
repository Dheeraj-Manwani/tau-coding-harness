/**
 * The catalog of sandbox templates the agent can boot into.
 *
 * A `TemplateKey` is what we persist on `Project.templateKey` and what the agent
 * passes to `provision_sandbox`; `e2bName` is the published E2B image name that
 * `Sandbox.create(...)` actually takes. `build` is the E2B template definition,
 * used only by `scripts/build-template.ts` (kept lazy-importable so the worker
 * runtime never pulls the build-time `Template()` graph).
 *
 * There are two generations (doc/CONTEXT_AND_MEMORY_PLAN.md §6):
 *
 *   1 — three images (`frontend` | `fullstack` | `fullstack-db`). The agent
 *       picks one on its first `provision_sandbox` and the project is locked to
 *       it. Every project created before generation 2 is one of these.
 *   2 — one base image (`tau-app-v2`). There is nothing to pick; an app starts
 *       frontend-only and grows from there. The three `v2-*` keys are stack
 *       *levels* of that one image, not three images: `add_backend` and
 *       `add_database` (lib/appStack.ts) set a server or a database up inside
 *       the running sandbox and move the project's key up a level.
 *
 * Which generation a *new* project gets is `env.TEMPLATE_GENERATION`. An
 * existing project always stays on the key it was created with.
 */
import type { TemplateClass } from "e2b";

export const TEMPLATE_KEYS = [
  "frontend",
  "fullstack",
  "fullstack-db",
  "v2-frontend",
  "v2-fullstack",
  "v2-fullstack-db",
] as const;

export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export type TemplateGeneration = 1 | 2;

export const DEFAULT_TEMPLATE_KEY: TemplateKey = "fullstack";

/** What every generation-2 project starts as. */
export const BASE_TEMPLATE_KEY: TemplateKey = "v2-frontend";

export interface TemplateEntry {
  /** Published E2B image name passed to Sandbox.create(). */
  e2bName: string;
  /** Human label for logs / tool descriptions. */
  label: string;
  generation: TemplateGeneration;
  hasServer: boolean;
  hasDb: boolean;
  /** Lazily load the E2B build definition (build-time only). */
  load: () => Promise<TemplateClass>;
}

export const TEMPLATES: Record<TemplateKey, TemplateEntry> = {
  frontend: {
    e2bName: "vite-spa-app",
    label: "Frontend-only (Vite + React, no backend)",
    generation: 1,
    hasServer: false,
    hasDb: false,
    load: async () => (await import("./vite-react")).template,
  },
  fullstack: {
    e2bName: "vite-hono-app",
    label: "Full-stack (Vite + React + Hono API, no DB)",
    generation: 1,
    hasServer: true,
    hasDb: false,
    load: async () => (await import("./vite-react-hono")).template,
  },
  "fullstack-db": {
    e2bName: "vite-hono-db-app",
    label: "Full-stack + database (Hono API + PGlite/Drizzle, pre-wired)",
    generation: 1,
    hasServer: true,
    hasDb: true,
    load: async () => (await import("./vite-react-hono-db")).template,
  },
  "v2-frontend": {
    e2bName: "tau-app-v2",
    label: "Base app (Vite + React; frontend only)",
    generation: 2,
    hasServer: false,
    hasDb: false,
    load: async () => (await import("./tau-app")).template,
  },
  "v2-fullstack": {
    e2bName: "tau-app-v2",
    label: "Base app + Hono API (added in place)",
    generation: 2,
    hasServer: true,
    hasDb: false,
    load: async () => (await import("./tau-app")).template,
  },
  "v2-fullstack-db": {
    e2bName: "tau-app-v2",
    label: "Base app + Hono API + PGlite/Drizzle (added in place)",
    generation: 2,
    hasServer: true,
    hasDb: true,
    load: async () => (await import("./tau-app")).template,
  },
};

/**
 * One key per published image: the first key that names it.
 *
 * The build and smoke-test scripts work on images, and the three generation-2
 * levels share one. Building it three times would be waste; smoke-testing the
 * bare image against the `v2-fullstack` flags would look for a server the
 * image deliberately does not contain.
 */
export const IMAGE_KEYS: TemplateKey[] = TEMPLATE_KEYS.filter(
  (key, i) =>
    TEMPLATE_KEYS.findIndex(
      (other) => TEMPLATES[other].e2bName === TEMPLATES[key].e2bName,
    ) === i,
);

/** The key whose flags describe an image as it is published. */
export function imageKeyFor(key: TemplateKey): TemplateKey {
  return (
    IMAGE_KEYS.find((k) => TEMPLATES[k].e2bName === TEMPLATES[key].e2bName) ??
    key
  );
}

export function isTemplateKey(value: unknown): value is TemplateKey {
  return (
    typeof value === "string" &&
    (TEMPLATE_KEYS as readonly string[]).includes(value)
  );
}

/**
 * A key the agent is allowed to ask for in `provision_sandbox`. Only
 * generation 1 has a stack to choose; a generation-2 key is never something the
 * model picks.
 */
export function isSelectableTemplateKey(value: unknown): value is TemplateKey {
  return isTemplateKey(value) && TEMPLATES[value].generation === 1;
}

/** Coerce arbitrary input to a valid key, falling back to the default. */
export function toTemplateKey(value: unknown): TemplateKey {
  return isTemplateKey(value) ? value : DEFAULT_TEMPLATE_KEY;
}

export function e2bNameFor(key: TemplateKey): string {
  return TEMPLATES[key].e2bName;
}

/**
 * The template a project runs on.
 *
 * Once template files have been seeded the project is `locked`: its stored key
 * wins and nothing else is consulted, so an app is never switched out from
 * under files that were scaffolded against a different image. Before that, a
 * generation-2 deployment gives every new project the base template, and a
 * generation-1 deployment honours the agent's `requested` key.
 *
 * The system prompt and the provisioner both call this, with the same inputs,
 * so the stack the agent is told about is the stack it boots into. It takes
 * the generation as an argument rather than reading `env` so the build scripts
 * can import this module without a full server environment.
 */
export function resolveTemplateKey(opts: {
  storedKey: unknown;
  locked: boolean;
  newProjectGeneration: TemplateGeneration;
  requested?: TemplateKey;
}): TemplateKey {
  if (opts.locked) return toTemplateKey(opts.storedKey);
  if (opts.newProjectGeneration === 2) return BASE_TEMPLATE_KEY;
  return opts.requested ?? toTemplateKey(opts.storedKey);
}
