import * as authRepository from "../repositories/auth.repository";
import { Errors } from "../lib/errors";
import {
  readPreferences,
  type Preferences,
  type PreferencesPatch,
} from "../schemas/preferences.schema";

/**
 * Apply a validated patch and return the full, sanitised preferences.
 *
 * Tour results arrive as `{ version, outcome }`; the completion time is stamped
 * here so the client cannot backdate it.
 */
export async function updatePreferences(
  userId: string,
  patch: PreferencesPatch,
  now: Date = new Date(),
): Promise<Preferences> {
  const { tours, ...top } = patch;

  let stampedTours: Record<string, unknown> | undefined;
  if (tours) {
    stampedTours = {};
    for (const [id, result] of Object.entries(tours)) {
      if (result) stampedTours[id] = { ...result, at: now.toISOString() };
    }
  }

  const merged = await authRepository.mergeUserPreferences(
    userId,
    top,
    stampedTours,
  );
  if (merged === null) throw Errors.notFound("User not found");
  return readPreferences(merged);
}
