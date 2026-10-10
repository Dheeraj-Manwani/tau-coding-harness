import { redactProjectSecrets } from "@/lib/projectSecrets";

/**
 * A tau API key, anywhere in a tool result.
 *
 * `tau_sk_live_` + 32 base62 bytes, but the length is left open so a truncated
 * or future-format key is still caught. Matching the prefix is the point: it
 * exists precisely so a key is recognizable on sight.
 */
const TAU_KEY_PATTERN = /tau_sk_[A-Za-z0-9_-]{8,}/g;
const REDACTED = "tau_sk_***redacted***";

/** A storage key (`tau_st_` + 32 base64url bytes), for the same reason. */
const STORAGE_KEY_PATTERN = /tau_st_[A-Za-z0-9_-]{8,}/g;
const STORAGE_REDACTED = "tau_st_***redacted***";

/**
 * Strip API keys out of anything a tool hands back to the model.
 *
 * The key reaches the sandbox two ways — a `.env` file and `Sandbox.create({
 * envs })` — so `run_command("env")`, `cat .env`, `read_file(".env")` and a
 * printenv in a build script can all surface it. The system prompt forbids
 * logging it; nothing enforced that, and a tool result is not just shown to the
 * model, it is persisted into the job transcript where it outlives the sandbox.
 *
 * Applied at the executor rather than in `run-command.ts` on purpose: one choke
 * point every tool passes through cannot be forgotten by the next tool someone
 * adds.
 */
export function redactSecrets<T>(value: T): T {
  if (typeof value === "string") {
    return value.replace(TAU_KEY_PATTERN, REDACTED).replace(STORAGE_KEY_PATTERN, STORAGE_REDACTED) as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactSecrets(v)) as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactSecrets(v);
    return out as T;
  }
  return value;
}

/**
 * Both redactions, in one place every tool result passes through: the tau key
 * by its pattern, and the user's third-party keys by their stored values (a
 * Stripe or OpenWeather key has no format tau could match on).
 */
export async function redactToolResult<T>(projectId: string, value: T): Promise<T> {
  return redactSecrets(await redactProjectSecrets(projectId, value));
}
