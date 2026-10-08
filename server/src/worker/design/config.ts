/**
 * What a user chose about an app's look, and what an app's look currently is.
 *
 * Two different things, kept apart on purpose:
 *
 *   - `DesignConfig` is the user's choice — a style, a colour, a feel, an
 *     imported file — with everything they did not choose left out. It is
 *     stored on the project (`Project.designConfig`) and is the difference
 *     between "tau picked Editorial" and "the user asked for Editorial".
 *   - `DesignSummary` is what the app looks like now, read back from its
 *     `.tau/DESIGN.md`. It is what a restyle starts from.
 *
 * `normalizeDesignConfig` is the one door a choice comes through, from an API
 * request or from the database: anything it does not recognise is dropped
 * rather than refused, because a design that is mostly as asked is better than
 * no app.
 *
 * See doc/CONTEXT_AND_MEMORY_PLAN.md §5, layer 2.
 */
import { normalizeHex } from "./color";
import { readDesignMeta } from "./designMd";
import { DEFAULT_FONTS, STYLES, fontLabel, fontsFor, isFontPairing } from "./styles";
import {
  isStyleKey,
  type DesignConfig,
  NEUTRALS,
  type DesignReference,
  type Dials,
  type Mode,
  type Neutral,
  type StyleKey,
} from "./types";

/** An imported `DESIGN.md` longer than this is cut; the agent is sent far less anyway. */
export const MAX_IMPORTED_DESIGN_CHARS = 40_000;

/**
 * The three dials as one choice, for someone who does not want three sliders.
 * Density stays near the middle in all of them: how much is on a screen
 * depends on what the app is, more than on how loud it should be.
 */
export const FEEL_PRESETS: Record<"calm" | "balanced" | "bold", Dials> = {
  calm: { variance: 2, motion: 2, density: 4 },
  balanced: { variance: 5, motion: 5, density: 5 },
  bold: { variance: 8, motion: 8, density: 5 },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function dial(value: unknown): number | undefined {
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  if (value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(10, Math.max(1, Math.round(n))) : undefined;
}

const REFERENCE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/**
 * A reference image as stored, or null. Only a hash and a type: where the
 * bytes are kept is worked out from the hash and whose project it is, so a
 * stored choice can never point at somebody else's file.
 */
export function normalizeReference(raw: unknown): DesignReference | null {
  if (!isRecord(raw)) return null;
  const hash = typeof raw.hash === "string" ? raw.hash.toLowerCase() : "";
  const mimeType = typeof raw.mimeType === "string" ? raw.mimeType.toLowerCase() : "";
  if (!/^[0-9a-f]{64}$/.test(hash) || !REFERENCE_TYPES.includes(mimeType)) return null;
  return { hash, mimeType };
}

/**
 * A design choice with everything unusable removed, or null when nothing is
 * left — which means "let tau decide", the same as never having chosen.
 */
export function normalizeDesignConfig(raw: unknown): DesignConfig | null {
  if (!isRecord(raw)) return null;
  const config: DesignConfig = {};

  if (isStyleKey(raw.style)) config.style = raw.style;

  const accent = normalizeHex(raw.accent);
  if (accent) config.accent = accent;

  if (raw.mode === "light" || raw.mode === "dark") config.mode = raw.mode;
  if (typeof raw.switch === "boolean") config.switch = raw.switch;
  if (raw.neutral === "style" || NEUTRALS.includes(raw.neutral as Neutral)) {
    config.neutral = raw.neutral as DesignConfig["neutral"];
  }

  // A pairing belongs to a style, so it means nothing without one. The
  // style's own pairing is kept when asked for by name: on a restyle it is how
  // someone goes back to it from one of the alternatives.
  if (config.style && isFontPairing(STYLES[config.style], raw.fonts)) {
    config.fonts = raw.fonts;
  }

  if (isRecord(raw.dials)) {
    const dials: Partial<Dials> = {};
    for (const name of ["variance", "motion", "density"] as const) {
      const value = dial(raw.dials[name]);
      if (value !== undefined) dials[name] = value;
    }
    if (Object.keys(dials).length > 0) config.dials = dials;
  }

  if (typeof raw.designMd === "string" && raw.designMd.trim().length > 0) {
    config.designMd = raw.designMd.trim().slice(0, MAX_IMPORTED_DESIGN_CHARS);
    // The picture a design was read from means nothing without the design.
    const reference = normalizeReference(raw.reference);
    if (reference) config.reference = reference;
  }

  return Object.keys(config).length > 0 ? config : null;
}

/** What an app's design is now, as far as its `DESIGN.md` says. */
export interface DesignSummary {
  style: StyleKey;
  styleName: string;
  accent: string;
  mode: Mode;
  dials: Dials;
  /** The pairing key: `"default"` for the style's own. */
  fonts: string;
  fontsLabel: string;
  /** The design was built around a file the user brought. */
  imported: boolean;
  /** The app has a light and dark switch of its own. */
  switch: boolean;
  /** Where the user asked the neutrals to lean; null for the style's own. */
  neutral: Neutral | null;
}

/**
 * Read an app's current design back from its `DESIGN.md`. Null when the file
 * is missing or is not one tau wrote — an app like that can be given a style,
 * but has none to report.
 */
export function describeDesign(designMd: string | null | undefined): DesignSummary | null {
  if (!designMd) return null;
  const meta = readDesignMeta(designMd);
  if (!meta || !isStyleKey(meta.style)) return null;
  const style = STYLES[meta.style];
  const fonts = isFontPairing(style, meta.fonts) ? meta.fonts : DEFAULT_FONTS;
  const imported = meta.source === "import";
  // An imported design has whichever of its own typefaces could be installed,
  // which only the file itself records.
  const own = imported
    ? /headings use \*\*(.+?)\*\* \(`font-heading`\), text is \*\*(.+?)\*\* \(`font-sans`\)/.exec(designMd)
    : null;
  return {
    style: style.key,
    styleName: style.name,
    accent: normalizeHex(meta.accent) ?? "#000000",
    mode: meta.mode === "dark" || meta.mode === "light" ? meta.mode : style.defaultMode,
    dials: {
      variance: dial(meta.variance) ?? style.dials.variance,
      motion: dial(meta.motion) ?? style.dials.motion,
      density: dial(meta.density) ?? style.dials.density,
    },
    fonts,
    fontsLabel: own
      ? own[1] === own[2]
        ? own[1]!
        : `${own[1]} + ${own[2]}`
      : fontLabel(fontsFor(style, fonts)),
    imported,
    switch: meta.switch === "1",
    neutral: NEUTRALS.includes(meta.neutral as Neutral) ? (meta.neutral as Neutral) : null,
  };
}
