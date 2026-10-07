/**
 * The style library as something a person chooses from.
 *
 * `StyleSpec` is written for the code that builds an app. Someone picking a
 * look in the composer needs less and something different: a name, a line on
 * what it looks like and what it suits, the font pairings on offer, and a few
 * real colours to draw a swatch with. This is that view, and the only one the
 * web app is sent — the web keeps no list of styles of its own, so a style
 * added here appears in the picker without anything else changing.
 *
 * Pure. See doc/CONTEXT_AND_MEMORY_PLAN.md §5, layer 2.
 */
import { FEEL_PRESETS } from "./config";
import { buildTheme } from "./palette";
import { ALL_STYLES, DEFAULT_FONTS, fontLabel } from "./styles";
import {
  STYLE_GROUPS,
  type Dials,
  type Mode,
  type StyleGroupKey,
  type StyleKey,
  type StyleSpec,
} from "./types";

/**
 * An accent that shows each style as it is meant to look, for its preview:
 * the colour its thumbnail is drawn in and its swatch is built from. Not a
 * default — an app's accent is chosen for its subject.
 */
export const SAMPLE_ACCENTS: Record<StyleKey, string> = {
  editorial: "#a4442a",
  swiss: "#e2401c",
  brutalist: "#ffd600",
  soft: "#7c6bf2",
  terminal: "#39d98a",
  bento: "#2f7d6b",
  playful: "#ff5a5f",
  luxe: "#c8a45c",
  workbench: "#2f6fb0",
  craft: "#b5532a",
  neon: "#d63cff",
  formal: "#1f3a6e",
  minimal: "#ff4f1a",
  glass: "#5b8def",
  clay: "#f47c7c",
  neumorphic: "#e8643c",
  pixel: "#3d46f2",
  y2k: "#ff4fb4",
  cybercore: "#f0331a",
  synthwave: "#ff2fb0",
  cyberpunk: "#fcee0a",
};

/** Accents offered as one-click choices beside the colour picker. */
export const SUGGESTED_ACCENTS = [
  "#c2410c",
  "#b45309",
  "#4d7c0f",
  "#0f766e",
  "#0e7490",
  "#1d4ed8",
  "#6d28d9",
  "#be185d",
  "#be123c",
  "#44403c",
] as const;

export interface CatalogStyle {
  key: StyleKey;
  name: string;
  /** Other names the look goes by, for a subtitle and for search. May be empty. */
  aka: string[];
  /** Which of the catalog's `groups` it is shown under. */
  group: StyleGroupKey;
  look: string;
  suits: string;
  defaultMode: Mode;
  dials: Dials;
  /** The pairings on offer, the style's own first. */
  fonts: { key: string; label: string }[];
  /** A few colours of the style in its own mode and sample accent, for a swatch. */
  swatch: {
    background: string;
    card: string;
    foreground: string;
    primary: string;
    border: string;
  };
  sampleAccent: string;
}

function catalogStyle(style: StyleSpec): CatalogStyle {
  const sampleAccent = SAMPLE_ACCENTS[style.key];
  const theme = buildTheme(style.palette, sampleAccent, style.radius, { mode: style.defaultMode });
  const p = theme[style.defaultMode];
  return {
    key: style.key,
    name: style.name,
    aka: [...(style.aka ?? [])],
    group: style.group,
    look: style.look,
    suits: style.suits,
    defaultMode: style.defaultMode,
    dials: { ...style.dials },
    fonts: [
      { key: DEFAULT_FONTS, label: fontLabel(style.fonts) },
      ...style.fontOptions.map((o) => ({ key: o.key, label: o.label })),
    ],
    swatch: {
      background: p.background,
      card: p.card,
      foreground: p.foreground,
      primary: p.primary,
      border: p.border,
    },
    sampleAccent,
  };
}

export interface DesignCatalog {
  styles: CatalogStyle[];
  /** The families the styles are shown in, in order. Every one has a style. */
  groups: { key: StyleGroupKey; label: string; title: string }[];
  feelPresets: typeof FEEL_PRESETS;
  suggestedAccents: readonly string[];
}

export function designCatalog(): DesignCatalog {
  return {
    styles: ALL_STYLES.map(catalogStyle),
    groups: STYLE_GROUPS.map((g) => ({ ...g })),
    feelPresets: FEEL_PRESETS,
    suggestedAccents: SUGGESTED_ACCENTS,
  };
}
