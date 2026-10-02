import { z } from "zod";

export const DISPLAY_NAME_MAX = 40;

/**
 * Normalise a display name: strip control/format characters (zero-width
 * joiners, bidi overrides — the ones that make a name render as something
 * else), collapse whitespace, trim. Empty means "no name".
 */
export function normalizeDisplayName(raw: string): string | null {
  const cleaned = raw
    .normalize("NFC")
    .replace(/\p{C}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  return Array.from(cleaned).slice(0, DISPLAY_NAME_MAX).join("");
}

export const patchProfileSchema = z
  .object({
    displayName: z
      .string()
      .max(200, "That name is a little long")
      .nullable()
      .transform((v) => (v === null ? null : normalizeDisplayName(v))),
  })
  .strict();

export type ProfilePatch = z.infer<typeof patchProfileSchema>;

/** A time zone the runtime knows. Unknown or missing falls back to UTC. */
export function safeTimeZone(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 64) {
    return "UTC";
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: raw });
    return raw;
  } catch {
    return "UTC";
  }
}
