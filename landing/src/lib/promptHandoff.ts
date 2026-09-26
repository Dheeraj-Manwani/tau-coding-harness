/**
 * Carries the idea a visitor typed into the landing hero all the way to their
 * first build.
 *
 * The route is long and crosses a tab boundary: hero → `/signup?prompt=…` →
 * `/verify-pending` → an email link that may well open in a *new* tab → `/`.
 * `sessionStorage` dies at that boundary, so this uses `localStorage` with an
 * explicit expiry rather than leaving a stranger's sentence sitting in their
 * browser forever.
 *
 * Lives in `lib/` rather than in `features/marketing` because three unrelated
 * surfaces touch it — the hero writes the URL, signup stashes it, and the
 * builder consumes it — and none of them should have to import the others.
 */

/** Query-string key the hero uses to hand the prompt to signup. */
export const PROMPT_PARAM = "prompt";

const STORAGE_KEY = "tau.pendingPrompt";

/**
 * Long enough for a real spec, short enough that a pathological URL can't be
 * used to stuff someone's localStorage.
 */
const MAX_LENGTH = 4000;

/** Past this, the idea is stale and prefilling it would just be confusing. */
const TTL_MS = 24 * 60 * 60 * 1000;

interface StoredPrompt {
  text: string;
  savedAt: number;
}

/** Called on `/signup` when the hero handed us a prompt in the query string. */
export function stashPendingPrompt(text: string): void {
  const trimmed = text.trim().slice(0, MAX_LENGTH);
  if (!trimmed) return;
  try {
    const payload: StoredPrompt = { text: trimmed, savedAt: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Private mode, or a full quota. Losing the prefill is not worth an error.
  }
}

/**
 * Reads without consuming, so it is safe to call from a `useState` initializer
 * (which React may invoke more than once per mount under StrictMode). Pair it
 * with `clearPendingPrompt` in an effect.
 */
export function peekPendingPrompt(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredPrompt>;
    if (typeof parsed.text !== "string" || typeof parsed.savedAt !== "number") {
      return null;
    }
    if (Date.now() - parsed.savedAt > TTL_MS) return null;
    return parsed.text;
  } catch {
    return null;
  }
}

export function clearPendingPrompt(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do — the TTL will retire it anyway.
  }
}
