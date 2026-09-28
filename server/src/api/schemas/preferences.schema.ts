import { z } from "zod";

/**
 * Account-level preferences, stored as one jsonb column on `User`.
 *
 * Only state that should follow the *person* lives here. Anything tied to the
 * device (browser notification permission, for one) stays in the web app's
 * localStorage. The database does not enforce this shape, so this file is the
 * contract: `patchPreferencesSchema` gates every write, `readPreferences`
 * sanitises every read.
 */

export const TOUR_IDS = ["workspace", "preview"] as const;
export type TourId = (typeof TOUR_IDS)[number];

const effortSchema = z.enum(["LOW", "HIGH", "MAX"]);
const tourOutcomeSchema = z.enum(["completed", "skipped"]);

const tourVersionSchema = z.number().int().min(1).max(1000);

/** What the client sends when a tour ends. The server stamps `at`. */
const tourResultInputSchema = z
  .object({ version: tourVersionSchema, outcome: tourOutcomeSchema })
  .strict();

/** What is stored. Not strict: an extra key on read is harmless. */
const tourRecordSchema = z.object({
  version: tourVersionSchema,
  outcome: tourOutcomeSchema,
  at: z.string(),
});

export type TourRecord = z.infer<typeof tourRecordSchema>;

export interface Preferences {
  reduceMotion?: boolean;
  hasSeenMotionIntro?: boolean;
  lastEffort?: z.infer<typeof effortSchema>;
  tours?: Partial<Record<TourId, TourRecord>>;
}

export const patchPreferencesSchema = z
  .object({
    reduceMotion: z.boolean(),
    hasSeenMotionIntro: z.boolean(),
    lastEffort: effortSchema,
    tours: z
      .object({
        workspace: tourResultInputSchema,
        preview: tourResultInputSchema,
      })
      .partial()
      .strict(),
  })
  .partial()
  .strict()
  .refine((p) => Object.keys(p).length > 0, {
    message: "No preferences to update",
  });

export type PreferencesPatch = z.infer<typeof patchPreferencesSchema>;

// Read side: every field falls back independently, so one bad value (a key
// renamed in code, a hand-edited row) costs that one setting rather than
// failing `/auth/me` for the whole account.
const storedPreferencesSchema = z.object({
  reduceMotion: z.boolean().optional().catch(undefined),
  hasSeenMotionIntro: z.boolean().optional().catch(undefined),
  lastEffort: effortSchema.optional().catch(undefined),
  tours: z
    .object({
      workspace: tourRecordSchema.optional().catch(undefined),
      preview: tourRecordSchema.optional().catch(undefined),
    })
    .optional()
    .catch(undefined),
});

export function readPreferences(raw: unknown): Preferences {
  const parsed = storedPreferencesSchema.safeParse(raw);
  if (!parsed.success) return {};
  return stripUndefined(parsed.data) as Preferences;
}

function stripUndefined(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (v === undefined) continue;
    out[key] =
      v !== null && typeof v === "object" && !Array.isArray(v)
        ? stripUndefined(v as Record<string, unknown>)
        : v;
  }
  return out;
}
