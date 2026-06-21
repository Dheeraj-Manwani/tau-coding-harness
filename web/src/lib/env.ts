/**
 * Validated, typed access to the Vite env. Keep all `import.meta.env` reads here
 * so a missing/misconfigured variable fails loudly in one place.
 */
const API_URL = (
  import.meta.env.VITE_API_URL ?? "http://localhost:3000"
).replace(/\/$/, "");

export const env = {
  API_URL,
  /** Web route the API redirects to after Google OAuth (see OAUTH_SUCCESS_REDIRECT). */
  OAUTH_CALLBACK_PATH: "/auth/callback",
} as const;
