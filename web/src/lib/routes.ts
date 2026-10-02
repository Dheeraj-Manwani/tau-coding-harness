/**
 * Client route constants for the authenticated product.
 *
 * The product has its own origin (app.tauai.pro), so product routes no longer
 * need an `/app` prefix. Public marketing links use LANDING_ORIGIN below.
 */
export const APP_HOME = "/";
export const APP_BILLING = "/billing";
export const APP_ACCOUNT = "/account";

export const LANDING_ORIGIN =
  import.meta.env.VITE_LANDING_URL?.replace(/\/+$/, "") ??
  (import.meta.env.DEV ? "http://localhost:5173" : "https://tauai.pro");

export const LANDING_HOME = `${LANDING_ORIGIN}/`;
export const LANDING_DOCS = `${LANDING_ORIGIN}/docs`;
export const LANDING_PRICING = `${LANDING_ORIGIN}/pricing`;
export const LANDING_PRIVACY = `${LANDING_ORIGIN}/privacy`;
export const LANDING_TERMS = `${LANDING_ORIGIN}/terms`;

/** The builder workspace for one project. */
export function projectPath(projectId: string): string {
  return `/project/${projectId}`;
}
