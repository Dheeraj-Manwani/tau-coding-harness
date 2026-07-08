/**
 * The catalog of sandbox templates the agent can boot into.
 *
 * A `TemplateKey` is what we persist on `Project.templateKey` and what the agent
 * passes to `provision_sandbox`; `e2bName` is the published E2B image name that
 * `Sandbox.create(...)` actually takes. `build` is the E2B template definition,
 * used only by `scripts/build-template.ts` (kept lazy-importable so the worker
 * runtime never pulls the build-time `Template()` graph).
 */
import type { TemplateClass } from "e2b";

export const TEMPLATE_KEYS = [
  "frontend",
  "fullstack",
  "fullstack-db",
] as const;

export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export const DEFAULT_TEMPLATE_KEY: TemplateKey = "fullstack";

export interface TemplateEntry {
  /** Published E2B image name passed to Sandbox.create(). */
  e2bName: string;
  /** Human label for logs / tool descriptions. */
  label: string;
  hasServer: boolean;
  hasDb: boolean;
  /** Lazily load the E2B build definition (build-time only). */
  load: () => Promise<TemplateClass>;
}

export const TEMPLATES: Record<TemplateKey, TemplateEntry> = {
  frontend: {
    e2bName: "vite-spa-app",
    label: "Frontend-only (Vite + React, no backend)",
    hasServer: false,
    hasDb: false,
    load: async () => (await import("./vite-react")).template,
  },
  fullstack: {
    e2bName: "vite-hono-app",
    label: "Full-stack (Vite + React + Hono API, no DB)",
    hasServer: true,
    hasDb: false,
    load: async () => (await import("./vite-react-hono")).template,
  },
  "fullstack-db": {
    e2bName: "vite-hono-db-app",
    label: "Full-stack + database (Hono API + PGlite/Drizzle, pre-wired)",
    hasServer: true,
    hasDb: true,
    load: async () => (await import("./vite-react-hono-db")).template,
  },
};

export function isTemplateKey(value: unknown): value is TemplateKey {
  return (
    typeof value === "string" &&
    (TEMPLATE_KEYS as readonly string[]).includes(value)
  );
}

/** Coerce arbitrary input to a valid key, falling back to the default. */
export function toTemplateKey(value: unknown): TemplateKey {
  return isTemplateKey(value) ? value : DEFAULT_TEMPLATE_KEY;
}

export function e2bNameFor(key: TemplateKey): string {
  return TEMPLATES[key].e2bName;
}
