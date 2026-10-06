/**
 * What a style is.
 *
 * A style is the whole of a look, not a colour scheme: typefaces, how colour
 * is derived from an accent, corner and border and shadow treatment, how the
 * stock shadcn components are reshaped, which page structures suit it, and the
 * written rules an agent follows while building in it. Everything a style says
 * ends up in one of two places, both written by tau when an app is created:
 *
 *   - `src/index.css` — tokens and a component skin, enforced by the cascade;
 *   - `.tau/DESIGN.md` — the prose, handed to the agent with every request.
 *
 * See doc/CONTEXT_AND_MEMORY_PLAN.md §5.
 */
import type { LayoutKey } from "./layouts";

export type Mode = "light" | "dark";

export const STYLE_KEYS = [
  "editorial",
  "swiss",
  "brutalist",
  "soft",
  "terminal",
  "bento",
  "playful",
  "luxe",
  "workbench",
] as const;

export type StyleKey = (typeof STYLE_KEYS)[number];

export function isStyleKey(value: unknown): value is StyleKey {
  return typeof value === "string" && (STYLE_KEYS as readonly string[]).includes(value);
}

/** A typeface, and how an app gets it. */
export interface FontRef {
  /** What to call it in prose: "Fraunces". */
  name: string;
  /** The CSS `font-family` value, with fallbacks. */
  stack: string;
  /**
   * The npm package that ships the font files, self-hosted with the app, and
   * the CSS files to import from it. Omitted for a system font stack.
   */
  pkg?: string;
  imports?: readonly string[];
}

/** A lightness and a chroma; the hue comes from the accent or the neutral. */
export interface Tone {
  l: number;
  c: number;
}

/** How one mode's palette is laid out. Hues are filled in from the accent. */
export interface ModeRecipe {
  background: Tone;
  /** Cards and other raised surfaces. */
  surface: Tone;
  foreground: Tone;
  /** Quiet fills: `muted` and `secondary`. */
  muted: Tone;
  mutedForeground: Tone;
  border: Tone;
  /** How the accent is rendered as `primary`: target lightness, and a chroma ceiling. */
  primary: Tone;
  /** The faint accent-tinted fill used for hover states (`accent`). */
  wash: Tone;
}

export interface PaletteRecipe {
  /** Where the neutrals get their hue: the accent's, or a fixed one. */
  neutralHue: "accent" | number;
  light: ModeRecipe;
  dark: ModeRecipe;
  /**
   * Hue offsets, from the accent, of the four chart colours after the first
   * (which is the accent). Close offsets read as one family; wide ones as a set
   * of distinct colours.
   */
  chartHues: readonly [number, number, number, number];
  /**
   * Lightness of those four chart colours, per mode. Omit for the default,
   * which steps between mid and dark so the colours hold up as lines and text.
   * A style that fills blocks with them, under ink text, wants them brighter.
   */
  chartLightness?: {
    light: readonly [number, number, number, number];
    dark: readonly [number, number, number, number];
  };
  /**
   * The style always draws an outline around anything filled with the accent,
   * so the accent need not stand out from the page by itself. Lets a bright
   * yellow or lime stay bright on a light page instead of being darkened until
   * it could be seen without the outline. Such an accent is for fills, not text.
   */
  fencedPrimary?: boolean;
}

/**
 * The knobs of the component skin: values the shared skin CSS (`css.ts`) reads
 * as custom properties. A style sets all of them, then adds whatever CSS of its
 * own makes it unmistakable (`skinCss`).
 */
export interface SkinVars {
  controlHeight: string;
  controlPadX: string;
  controlRadius: string;
  controlText: string;
  borderWidth: string;

  buttonFont: string;
  buttonWeight: string;
  buttonTracking: string;
  buttonCase: "none" | "uppercase" | "lowercase";

  /** `outlined`: a full border. `underline`: a rule beneath. `filled`: a tinted block, no border. */
  field: "outlined" | "underline" | "filled";
  fieldRadius: string;
  fieldPadX: string;

  cardRadius: string;
  cardPad: string;
  /** A full `border` shorthand, or `0`. */
  cardBorder: string;
  cardShadow: string;
  cardTitleSize: string;
  cardTitleWeight: string;
  cardTitleTracking: string;

  badgeRadius: string;
  badgeFont: string;
  badgeCase: "none" | "uppercase" | "lowercase";
  badgeTracking: string;
  badgeWeight: string;
  badgeText: string;
  badgePad: string;

  /** `segmented`: a tray with a raised active tab. `underline`: a rule under the active tab. `boxed`: adjoining outlined cells. */
  tabs: "segmented" | "underline" | "boxed";
  tabsRadius: string;

  overlayRadius: string;
  overlayBorder: string;
  overlayShadow: string;

  /** Small labels: form labels and table headers. */
  labelFont: string;
  labelCase: "none" | "uppercase";
  labelTracking: string;
  labelText: string;
  labelWeight: string;

  checkRadius: string;
  /** lucide's stroke width for every icon. */
  iconStroke: string;
}

/** The three feel dials, 1–10. */
export interface Dials {
  /** 1 symmetric and predictable … 10 asymmetric and surprising. */
  variance: number;
  /** 1 still … 10 cinematic. */
  motion: number;
  /** 1 airy … 10 packed. */
  density: number;
}

export interface StyleSpec {
  key: StyleKey;
  name: string;
  /** One line on the look, for whoever is choosing a style. */
  look: string;
  /** What it suits, for whoever is choosing a style. */
  suits: string;
  /** What it is wrong for — "Not for …" — which narrows a choice more than praise does. */
  avoid: string;

  fonts: { display: FontRef; body: FontRef; mono: FontRef };
  defaultMode: Mode;
  dials: Dials;
  /** The base `--radius`. */
  radius: string;
  palette: PaletteRecipe;

  /** Tailwind theme tokens the style overrides: shadows, type scale. */
  theme: Readonly<Record<string, string>>;
  /** CSS for the base layer: headings, body. */
  baseCss: string;
  skin: SkinVars;
  /** The style's own skin CSS, after the shared rules. */
  skinCss: string;

  layouts: readonly LayoutKey[];

  /** The prose that becomes `.tau/DESIGN.md`. Short paragraphs, plain sentences. */
  prose: {
    overview: string;
    colors: string;
    typography: string;
    layout: string;
    elevation: string;
    shapes: string;
    /** One line per component, as rendered by the skin. */
    components: {
      button: string;
      card: string;
      input: string;
      badge: string;
      tabs: string;
      dialog: string;
    };
    icons: string;
    dos: readonly string[];
    donts: readonly string[];
  };
}

/** What was decided for one app: a style, and how it is tuned. */
export interface DesignChoice {
  style: StyleKey;
  /** The accent colour, as hex. */
  accent: string;
  /** The brief named this exact colour, so it is used as given rather than fitted to the style. */
  accentExact: boolean;
  mode: Mode;
  dials: Dials;
  /** "Reading this as …" — one sentence on what is being built and how it should feel. */
  read: string;
  /** How the choice was made, for the run log. */
  source: "director" | "fallback";
}
