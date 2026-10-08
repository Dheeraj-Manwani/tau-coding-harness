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
  "craft",
  "neon",
  "formal",
  "minimal",
  "glass",
  "clay",
  "neumorphic",
  "pixel",
  "y2k",
  "cybercore",
  "synthwave",
  "cyberpunk",
] as const;

export type StyleKey = (typeof STYLE_KEYS)[number];

export function isStyleKey(value: unknown): value is StyleKey {
  return typeof value === "string" && (STYLE_KEYS as readonly string[]).includes(value);
}

/**
 * The families the library is shown in, in the order they are shown. Twenty-one
 * styles in one grid is too many to scan; five short rows are not.
 */
export const STYLE_GROUPS = [
  { key: "precise", label: "Clean", title: "Clean and precise" },
  { key: "crafted", label: "Classic", title: "Editorial and classic" },
  { key: "tactile", label: "Tactile", title: "Soft and tactile" },
  { key: "loud", label: "Bold", title: "Bold and playful" },
  { key: "tech", label: "Futuristic", title: "Technical and futuristic" },
] as const;

export type StyleGroupKey = (typeof STYLE_GROUPS)[number]["key"];

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

/** The three typefaces of a look. */
export interface FontSet {
  display: FontRef;
  body: FontRef;
  mono: FontRef;
}

/**
 * Another set of typefaces a style works in, for a user who likes the style
 * and not its type. Chosen to keep the style's character: a magazine style
 * offers other serifs, not a rounded sans.
 */
export interface FontPairing {
  /** Stable, lower-case: stored with the project. */
  key: string;
  /** What to call it where someone chooses: "Playfair Display + Karla". */
  label: string;
  fonts: FontSet;
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
  /**
   * How big an icon is when nothing sizes it, as a CSS length. A default, not
   * a rule: an icon given a size class, a `size` prop, or a place inside a
   * component that sizes its own icons keeps that size.
   */
  iconSize: string;
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
  /** Which family of looks it is shown with. */
  group: StyleGroupKey;
  /**
   * How widely the style can be used. A `general` style would not look wrong
   * on an app tau knows nothing about; a `niche` one is a strong look that a
   * brief has to call for. Only matters where a style is picked without the
   * director's judgement (`fallbackChoice`): a timeout must not hand a bakery
   * a pixel-art arcade.
   */
  reach: "general" | "niche";
  /**
   * The names people already know the look by — "Neo-brutalism",
   * "Glassmorphism" — where tau calls it something else or something shorter.
   * Shown beside the name, searched by the picker, and told to the director,
   * so a brief that asks for a look by its familiar name gets it.
   */
  aka?: readonly string[];

  fonts: FontSet;
  /** Other pairings the style works in. `fonts` is the default and is not repeated here. */
  fontOptions: readonly FontPairing[];
  defaultMode: Mode;
  dials: Dials;
  /** The base `--radius`. */
  radius: string;
  palette: PaletteRecipe;

  /** Tailwind theme tokens the style overrides: shadows, type scale. */
  theme: Readonly<Record<string, string>>;
  /** CSS for the base layer: headings, body. */
  baseCss: string;
  /**
   * A `background` value painted across the page, fixed behind everything: a
   * gradient, a grid, scanlines. Most styles have none — the page is the
   * background colour and the look is in the surfaces. A few are not
   * themselves without one: glass is only glass with colour behind it.
   *
   * Written with the palette's variables, so it follows the accent and both
   * modes, and kept faint enough that text placed straight on the page still
   * reads — the palette checks contrast against the background colour alone.
   */
  backdrop?: string;
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

/**
 * What a user asked for, when starting an app or restyling one. Every part is
 * optional, and whatever is left out is tau's to decide: someone who picks a
 * style and nothing else still gets a colour that suits the subject.
 *
 * Stored on the project (`Project.designConfig`) as the record of what the
 * user chose, as opposed to what tau chose for them.
 */
export interface DesignConfig {
  style?: StyleKey;
  /** `#rrggbb`. Used exactly as given. */
  accent?: string;
  mode?: Mode;
  /** A font pairing of the style: `"default"` or a key from its `fontOptions`. */
  fonts?: string;
  dials?: Partial<Dials>;
  /** A `DESIGN.md` the user brought with them, whole. */
  designMd?: string;
  /**
   * The picture `designMd` was read from, when it was read from one: a
   * screenshot the user gave as "make it look like this". Kept with the
   * project so that what the design came from is not lost once the reading
   * has been made (`fromImage.ts`).
   */
  reference?: DesignReference;
}

/** A stored reference image, by the hash of its bytes. The key is derived, never taken on trust. */
export interface DesignReference {
  /** sha256 of the image, lower-case hex. */
  hash: string;
  mimeType: string;
}

/** What was decided for one app: a style, and how it is tuned. */
export interface DesignChoice {
  style: StyleKey;
  /** The accent colour, as hex. */
  accent: string;
  /** This exact colour was asked for, so it is used as given rather than fitted to the style. */
  accentExact: boolean;
  mode: Mode;
  dials: Dials;
  /** Which of the style's font pairings. Omitted for the style's own. */
  fonts?: string;
  /** "Reading this as …" — one sentence on what is being built and how it should feel. */
  read: string;
  /**
   * How the choice was made, for the run log: by the director from the brief,
   * by the fallback when the director could not, or with something the user
   * chose (`user`) or brought (`import`).
   */
  source: "director" | "fallback" | "user" | "import";
  /** A design the user imported, which this choice is built around. */
  imported?: ImportedDesign;
}

/**
 * How the components of an imported design are shaped, where its file says.
 * Laid over the skin of the style the design was fitted to, so a design with
 * pill buttons gets pill buttons whichever style was the closest match.
 */
export interface ImportedShapes {
  /** Corner radius of buttons and fields, as a CSS length. */
  control?: string;
  /** Corner radius of cards and panels, as a CSS length. */
  card?: string;
  /** The edge of a card: none, a thin line, or a heavy one. */
  borders?: "none" | "hairline" | "thick";
  /** How a card lifts off the page: not at all, softly, or as a hard offset block. */
  shadows?: "none" | "soft" | "hard";
  fields?: "outlined" | "underline" | "filled";
  /** Whether buttons and small labels are set in capitals. */
  labels?: "none" | "uppercase";
}

/** The parts of an imported `DESIGN.md` that tau can turn into a stylesheet. */
export interface ImportedTokens {
  /** Theme token name (`primary`, `background`, `card`, …) to hex. */
  colors: Record<string, string>;
  /** Family names as written: "Inter", "Playfair Display". */
  fonts: { display?: string; body?: string; mono?: string };
  /** A CSS length for `--radius`. */
  radius?: string;
  shapes?: ImportedShapes;
  /** How much is on a screen, 1 (airy) to 10 (packed), where the file says. */
  density?: number;
}

export interface ImportedDesign {
  /** The file as the user gave it. */
  text: string;
  tokens: ImportedTokens;
  /**
   * The file was written by tau from a screenshot rather than brought as a
   * file. It describes how something looks, not what it shows: the pictures,
   * logos and names in the screenshot are not part of the design.
   */
  fromImage?: boolean;
}
