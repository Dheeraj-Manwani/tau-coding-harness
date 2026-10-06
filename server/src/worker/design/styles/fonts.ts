/**
 * Typefaces, and the packages that ship them.
 *
 * Every font is self-hosted through Fontsource: the files are installed with
 * the app and served by it, so the preview and the published site make no
 * request to a font CDN and look the same offline. `test/worker/design.test.ts`
 * checks each package named here against the list the sandbox image pre-loads.
 */
import type { FontRef } from "../types";

export const SANS_FALLBACK = "ui-sans-serif, system-ui, sans-serif";
export const SERIF_FALLBACK = 'ui-serif, Georgia, "Times New Roman", serif';
export const MONO_FALLBACK =
  'ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace';

/** A variable font: one file covers every weight. */
export function variableFont(
  name: string,
  slug: string,
  fallback: string,
  opts: { italic?: boolean } = {},
): FontRef {
  const pkg = `@fontsource-variable/${slug}`;
  return {
    name,
    stack: `"${name} Variable", ${fallback}`,
    pkg,
    imports: [pkg, ...(opts.italic ? [`${pkg}/wght-italic.css`] : [])],
  };
}

/** A font that ships one file per weight. */
export function staticFont(
  name: string,
  slug: string,
  weights: readonly number[],
  fallback: string,
): FontRef {
  const pkg = `@fontsource/${slug}`;
  return {
    name,
    stack: `"${name}", ${fallback}`,
    pkg,
    imports: weights.map((w) => `${pkg}/${w}.css`),
  };
}

/** No download: whatever monospace the visitor's system has. */
export const SYSTEM_MONO: FontRef = {
  name: "the system monospace",
  stack: MONO_FALLBACK,
};
