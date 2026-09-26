import { PROMPT_PARAM } from "./promptHandoff";

const configuredAppOrigin = import.meta.env.VITE_APP_URL?.replace(/\/+$/, "");

/** Authenticated product origin. Override in local development with VITE_APP_URL. */
export const APP_ORIGIN =
  configuredAppOrigin ??
  (import.meta.env.DEV ? "http://localhost:5174" : "https://app.tauai.pro");

export const APP_HOME = `${APP_ORIGIN}/`;
export const APP_BILLING = `${APP_ORIGIN}/billing`;

export function appPath(prompt?: string): string {
  if (!prompt) return APP_HOME;
  const url = new URL(APP_HOME);
  url.searchParams.set(PROMPT_PARAM, prompt);
  return url.toString();
}
