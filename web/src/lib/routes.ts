/**
 * Client route constants for the authenticated product.
 *
 * `/` belongs to the public marketing page, so every in-product destination
 * lives under `/app`. These are collected here (rather than spelled out at each
 * call site) because the split happened after the app shipped at `/` — a stray
 * literal is the easy way to reintroduce a link that bounces a signed-in user
 * through the landing page.
 */
export const APP_HOME = "/app";
export const APP_BILLING = "/app/billing";

/** The builder workspace for one project. */
export function projectPath(projectId: string): string {
  return `/app/project/${projectId}`;
}
