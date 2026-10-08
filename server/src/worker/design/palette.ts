/**
 * Turning a style's palette recipe and one accent colour into a full theme.
 *
 * A style does not carry colours. It carries the *structure* of a palette — how
 * light the page is, how much the surfaces lift off it, how strongly the
 * neutrals lean toward the accent, how saturated the accent is allowed to be —
 * and the colours come from the accent chosen for the app. So two apps in the
 * same style share a structure and not a colour, and a coffee roaster and a
 * dive shop built in "editorial" do not come out the same brown.
 *
 * What the recipe cannot be trusted with is legibility, since it does not know
 * the accent in advance. So every text colour is checked against the surface it
 * sits on and moved, in lightness only, until it can be read.
 *
 * Output is hex throughout (see `color.ts` for why). Pure.
 */
import {
  THEME_COLOR_TOKENS,
  type Palette,
  type Theme,
} from "../templates/theme";
import {
  contrast,
  ensureContrast,
  hexToOklch,
  oklchToHex,
  readableOn,
  type Oklch,
} from "./color";
import type { Mode, ModeRecipe, Neutral, PaletteRecipe, Tone } from "./types";

/** Hues for the neutrals, in OKLCH degrees: yellow-brown, and blue. */
const NEUTRAL_HUES = { warm: 70, cool: 255 } as const;

/** Body text against its background: WCAG AAA. */
const TEXT_CONTRAST = 7;
/** Secondary text and text on fills: WCAG AA. */
const QUIET_CONTRAST = 4.5;
/** A filled control against the page: enough to be seen as a shape. */
const SHAPE_CONTRAST = 3;
/** Below this a fill is the page's own colour, near enough, and cannot be seen at all. */
const SWALLOWED_CONTRAST = 1.5;

/** An accent with less chroma than this is a grey, and tints nothing. */
const GREY_CHROMA = 0.03;

const DESTRUCTIVE_HUE = 27;

function tone(t: Tone, h: number): Oklch {
  return { l: t.l, c: t.c, h };
}

function buildMode(
  recipe: ModeRecipe,
  mode: Mode,
  accent: Oklch,
  neutralHue: number,
  chartHues: PaletteRecipe["chartHues"],
  exactPrimary: string | null,
  fenced: boolean,
  chartLightness: readonly number[] | undefined,
  plainNeutrals = false,
): Palette {
  const grey = accent.c < GREY_CHROMA;
  // A grey accent has no hue worth spreading through the neutrals; neither
  // does a user who asked for plain ones.
  const n = (t: Tone): Oklch => tone(grey || plainNeutrals ? { ...t, c: 0 } : t, neutralHue);

  const background = oklchToHex(n(recipe.background));
  const surface = oklchToHex(n(recipe.surface));
  const muted = oklchToHex(n(recipe.muted));
  const border = oklchToHex(n(recipe.border));

  const foreground = oklchToHex(
    ensureContrast(n(recipe.foreground), background, TEXT_CONTRAST),
  );
  const onSurface = oklchToHex(
    ensureContrast(n(recipe.foreground), surface, TEXT_CONTRAST),
  );
  // Muted text shows up on the page and on muted fills; satisfy the harder one.
  let quiet = ensureContrast(n(recipe.mutedForeground), background, QUIET_CONTRAST);
  quiet = ensureContrast(quiet, muted, QUIET_CONTRAST);
  const mutedForeground = oklchToHex(quiet);

  // The accent as `primary`: the style decides how light and how saturated,
  // the accent decides the hue — unless the brief named an exact colour, in
  // which case it is used as given wherever it can be.
  let primary: Oklch = exactPrimary
    ? hexToOklch(exactPrimary)
    : {
        // Some hues only exist bright — a yellow or a lime at mid lightness is
        // mustard or olive. Where the style outlines its fills anyway, let a
        // light accent keep its own lightness.
        l: fenced ? Math.min(0.9, Math.max(recipe.primary.l, accent.l)) : recipe.primary.l,
        c: grey ? 0 : Math.min(recipe.primary.c, Math.max(accent.c, 0.06) * 1.25),
        h: accent.h,
      };
  // A colour someone named is theirs. Fitting it to the page would make it
  // more legible and no longer the one they chose: a brand green two shades
  // darker is a different green, and to the person who picked it, a bug. It is
  // moved only when the page would swallow it whole — cream on white — because
  // a button nobody can see is worse than a colour slightly off. The text on
  // it is always picked to be readable.
  const swallowed =
    exactPrimary !== null && contrast(exactPrimary, background) < SWALLOWED_CONTRAST;
  const asGiven = exactPrimary !== null && !swallowed;
  if (!fenced && !asGiven) primary = ensureContrast(primary, background, SHAPE_CONTRAST);
  let primaryHex = asGiven ? exactPrimary.toLowerCase() : oklchToHex(primary);
  let primaryForeground = readableOn(primaryHex);
  // Mid-lightness accents can fail against both black and white text; push the
  // fill away from whichever text colour won until the label reads.
  for (
    let i = 0;
    !asGiven && i < 30 && contrast(primaryForeground, primaryHex) < QUIET_CONTRAST;
    i++
  ) {
    const textIsLight = hexToOklch(primaryForeground).l > 0.5;
    primary = { ...primary, l: primary.l + (textIsLight ? -0.015 : 0.015) };
    primaryHex = oklchToHex(primary);
    primaryForeground = readableOn(primaryHex);
  }

  const wash = oklchToHex(tone(grey ? { ...recipe.wash, c: 0 } : recipe.wash, accent.h));
  const destructive = oklchToHex(
    ensureContrast(
      { l: mode === "light" ? 0.55 : 0.7, c: mode === "light" ? 0.21 : 0.18, h: DESTRUCTIVE_HUE },
      background,
      QUIET_CONTRAST,
    ),
  );

  // Charts: the accent first, then four companions at the style's hue offsets,
  // stepped in lightness so neighbours stay distinguishable in greyscale too.
  const chartC = grey ? 0.1 : Math.min(Math.max(primary.c, 0.09), 0.17);
  const steps =
    chartLightness ?? (mode === "light" ? [0.62, 0.5, 0.72, 0.42] : [0.72, 0.62, 0.82, 0.55]);
  const charts = chartHues.map((offset, i) =>
    oklchToHex({ l: steps[i]!, c: chartC, h: accent.h + offset }),
  );

  // A sidebar sits a half-step off the page, so it reads as a separate plane
  // without needing a heavy rule.
  const sidebar = oklchToHex(
    n({
      l: (recipe.background.l + recipe.muted.l) / 2,
      c: (recipe.background.c + recipe.muted.c) / 2,
    }),
  );

  const palette: Palette = {
    background,
    foreground,
    card: surface,
    "card-foreground": onSurface,
    popover: surface,
    "popover-foreground": onSurface,
    primary: primaryHex,
    "primary-foreground": primaryForeground,
    secondary: muted,
    "secondary-foreground": oklchToHex(
      ensureContrast(n(recipe.foreground), muted, TEXT_CONTRAST),
    ),
    muted,
    "muted-foreground": mutedForeground,
    accent: wash,
    "accent-foreground": oklchToHex(
      ensureContrast(n(recipe.foreground), wash, TEXT_CONTRAST),
    ),
    destructive,
    border,
    input: border,
    ring: primaryHex,
    "chart-1": primaryHex,
    "chart-2": charts[0]!,
    "chart-3": charts[1]!,
    "chart-4": charts[2]!,
    "chart-5": charts[3]!,
    sidebar,
    "sidebar-foreground": oklchToHex(
      ensureContrast(n(recipe.foreground), sidebar, TEXT_CONTRAST),
    ),
    "sidebar-primary": primaryHex,
    "sidebar-primary-foreground": primaryForeground,
    "sidebar-accent": wash,
    "sidebar-accent-foreground": oklchToHex(
      ensureContrast(n(recipe.foreground), wash, TEXT_CONTRAST),
    ),
    "sidebar-border": border,
    "sidebar-ring": primaryHex,
  };

  // Every token, or the file would be missing a declaration the app relies on.
  for (const name of THEME_COLOR_TOKENS) {
    if (!palette[name]) throw new Error(`Palette is missing ${name}`);
  }
  return palette;
}

/**
 * Build both palettes for an app.
 *
 * @param accent  the accent colour as hex
 * @param opts.exact  use the accent as `primary` unchanged in `opts.mode` (the
 *                    mode the app opens in). The other mode still gets the
 *                    style's own rendering of the same hue, since a colour
 *                    picked for a white page is rarely right on a black one.
 */
export function buildTheme(
  recipe: PaletteRecipe,
  accent: string,
  radius: string,
  opts: { exact?: boolean; mode?: Mode; neutral?: Neutral } = {},
): Theme {
  const a = hexToOklch(accent);
  const neutralHue =
    opts.neutral === "warm" || opts.neutral === "cool"
      ? NEUTRAL_HUES[opts.neutral]
      : recipe.neutralHue === "accent"
        ? a.h
        : recipe.neutralHue;
  const plain = opts.neutral === "grey";
  const exactIn = opts.exact ? (opts.mode ?? "light") : null;
  const fenced = recipe.fencedPrimary === true;

  return {
    radius,
    light: buildMode(recipe.light, "light", a, neutralHue, recipe.chartHues, exactIn === "light" ? accent : null, fenced, recipe.chartLightness?.light, plain),
    dark: buildMode(recipe.dark, "dark", a, neutralHue, recipe.chartHues, exactIn === "dark" ? accent : null, fenced, recipe.chartLightness?.dark, plain),
  };
}
