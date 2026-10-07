import { z } from "zod";
import { MAX_USER_INSTRUCTIONS_CHARS } from "@/worker/agent/context/standing";
import { normalizeDesignConfig } from "@/worker/design/config";
import { STYLE_KEYS, type DesignConfig } from "@/worker/design/types";

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

/**
 * The look a user wants new projects to start from: any of a style, an accent,
 * light or dark, a font pairing and the feel. Never an imported `DESIGN.md` —
 * a file belongs to the project it was written for.
 */
export type DefaultDesign = Omit<DesignConfig, "designMd">;

const dial = z.number().int().min(1).max(10);

const defaultDesignSchema = z
  .object({
    style: z.enum(STYLE_KEYS),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    mode: z.enum(["light", "dark"]),
    fonts: z.string().min(1).max(40),
    dials: z.object({ variance: dial, motion: dial, density: dial }).partial().strict(),
  })
  .partial()
  .strict();

/** A stored default look with anything unusable dropped; undefined when nothing is left. */
function readDefaultDesign(raw: unknown): DefaultDesign | undefined {
  const config = normalizeDesignConfig(raw);
  if (!config) return undefined;
  const { designMd: _file, ...rest } = config;
  return Object.keys(rest).length > 0 ? rest : undefined;
}

export interface Preferences {
  reduceMotion?: boolean;
  hasSeenMotionIntro?: boolean;
  lastEffort?: z.infer<typeof effortSchema>;
  tours?: Partial<Record<TourId, TourRecord>>;
  /**
   * Standing instructions for everything the user builds, in their own words.
   * Attached to every request (`worker/agent/context/standing.ts`).
   */
  instructions?: string;
  /** The look new projects start from unless the user chooses another. */
  defaultDesign?: DefaultDesign;
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
    // An empty string clears them.
    instructions: z
      .string()
      .max(MAX_USER_INSTRUCTIONS_CHARS, `Instructions can be at most ${MAX_USER_INSTRUCTIONS_CHARS} characters`)
      .refine((text) => !text.includes("\0"), "Instructions must be plain text"),
    // `null` clears it. Replaced whole, never merged: half of one default and
    // half of another is a look nobody chose.
    defaultDesign: defaultDesignSchema.nullable(),
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
  instructions: z
    .string()
    .transform((text) => text.trim().slice(0, MAX_USER_INSTRUCTIONS_CHARS) || undefined)
    .optional()
    .catch(undefined),
  defaultDesign: z.unknown().transform(readDefaultDesign).optional().catch(undefined),
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
