/**
 * Validated, typed access to the Vite env. Keep all `import.meta.env` reads here
 * so a missing/misconfigured variable fails loudly in one place.
 */
const API_URL = (
  import.meta.env.VITE_API_URL ?? "http://localhost:3000"
).replace(/\/$/, "");

// Live job streaming now rides the api origin over SSE (GET /jobs/:id/stream),
// so there is no separate ws-gateway URL anymore.

export const env = {
  API_URL,
  /** Web route the API redirects to after Google OAuth (see OAUTH_SUCCESS_REDIRECT). */
  OAUTH_CALLBACK_PATH: "/auth/callback",
  /** Razorpay publishable key  */
  RAZORPAY_KEY_ID: import.meta.env.VITE_RAZORPAY_KEY_ID ?? "",
} as const;
