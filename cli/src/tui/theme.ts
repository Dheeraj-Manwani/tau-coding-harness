/**
 * Single source of truth for the tau brand palette inside the TUI. These mirror
 * the constants already used by the non-TUI helpers (`ui/tau.ts`,
 * `ui/spinner.ts`, `ui/output.ts`) so the brand stays identical across both
 * front-ends — if a hue changes, change it here and in those modules together.
 */

/** The τ brand mark (U+03C4). */
export const TAU = "τ";

/** Brand violet — the τ mark, headings, list markers, mode labels. */
export const BRAND_VIOLET = "#8075E8";
/** Field violet — informational lines. */
export const FIELD_VIOLET = "#5B4FCF";
/** Lighter violet — inline code / chips. */
export const CODE_VIOLET = "#B8B0F4";
/** Flux green — success. */
export const FLUX_GREEN = "#28A874";
/** Error red — failures. */
export const ERROR_RED = "#C0595A";

/**
 * Colour wave for the "thinking" shimmer, ported verbatim from
 * {@link file://./../ui/spinner.ts}. Each glyph samples this palette at
 * `(frame + index) % length`, so the bright crest travels left-to-right.
 */
export const SHIMMER_WAVE = [
  "#8075E8",
  "#9D94EE",
  "#B8B0F4",
  "#D4D0F8",
  "#B8B0F4",
  "#9D94EE",
  "#8075E8",
  "#6B60D4",
  "#5B4FCF",
] as const;

/** Frame interval (ms) for the shimmer animation — matches the CLI spinner. */
export const SHIMMER_FRAME_MS = 120;
