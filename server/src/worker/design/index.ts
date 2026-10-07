/**
 * An app's design, from a choice to the two files that carry it.
 *
 * `DesignChoice` is the decision (which style, which accent, light or dark,
 * the three dials, a font pairing, perhaps a design the user brought).
 * `resolveDesign` fills in everything the decision implies — the typefaces and
 * the full palette for both modes — and `designFiles` writes it out as
 * `src/index.css`, which the app runs on, and `.tau/DESIGN.md`, which the
 * agent reads. Both are pure functions of the choice, so a restyle is the same
 * two calls with a different choice.
 *
 * See doc/CONTEXT_AND_MEMORY_PLAN.md §5.
 */
import type { Palette, Theme } from "../templates/theme";
import { buildDesignCss } from "./css";
import { readDesignMeta, renderDesignMd, renderImportedDesignMd } from "./designMd";
import type { CheckContext } from "./checks";
import { isStyleKey } from "./types";
import { buildTheme } from "./palette";
import { STYLES, fontsFor } from "./styles";
import type { DesignChoice, FontSet, Mode, StyleSpec } from "./types";

export interface ResolvedDesign {
  /** The style as this app has it: its typefaces are the chosen pairing's. */
  style: StyleSpec;
  choice: DesignChoice;
  theme: Theme;
}

/**
 * Lay an imported design's colours over the palette tau derived. Only the
 * palette the app opens in: a file gives one set of colours, and they were
 * chosen for one background. The other mode keeps the style's own rendering
 * of the same accent.
 *
 * Used as given. The style's palette is checked for contrast; a user's own
 * colours are theirs to get wrong.
 */
function withImportedColors(
  theme: Theme,
  colors: Readonly<Record<string, string>>,
  mode: Mode,
): Theme {
  const palette: Palette = { ...theme[mode] };
  const set = (value: string | undefined, ...names: (keyof Palette)[]) => {
    if (!value) return;
    for (const name of names) palette[name] = value;
  };
  set(colors.background, "background");
  set(colors.foreground, "foreground");
  set(colors.card, "card", "popover");
  // Text on a panel: what the file says, else its body text colour.
  set(colors["card-foreground"] ?? colors.foreground, "card-foreground", "popover-foreground");
  set(colors.muted, "muted", "secondary");
  set(colors["muted-foreground"], "muted-foreground");
  set(colors.border, "border", "input", "sidebar-border");
  set(colors.destructive, "destructive");
  set(colors["primary-foreground"], "primary-foreground", "sidebar-primary-foreground");
  return { ...theme, [mode]: palette };
}

/**
 * @param fonts  typefaces to use instead of the choice's pairing — for an
 *               imported design, whichever of its fonts could be installed
 */
export function resolveDesign(choice: DesignChoice, fonts?: FontSet): ResolvedDesign {
  const base = STYLES[choice.style];
  const style: StyleSpec = { ...base, fonts: fonts ?? fontsFor(base, choice.fonts) };
  const tokens = choice.imported?.tokens;

  let theme = buildTheme(base.palette, choice.accent, tokens?.radius ?? base.radius, {
    exact: choice.accentExact,
    mode: choice.mode,
  });
  if (tokens) theme = withImportedColors(theme, tokens.colors, choice.mode);

  return { style, choice, theme };
}

export function designFiles(
  design: ResolvedDesign,
  opts: { fontsInstalled: boolean },
): { css: string; designMd: string } {
  return {
    css: buildDesignCss({
      style: design.style,
      theme: design.theme,
      mode: design.choice.mode,
      dials: design.choice.dials,
      fontsInstalled: opts.fontsInstalled,
    }),
    designMd: design.choice.imported
      ? renderImportedDesignMd(design.style, design.choice, design.theme)
      : renderDesignMd(design.style, design.choice, design.theme),
  };
}

/**
 * What the design checks need to know about an app, from its `DESIGN.md` — or
 * null when it has none, which turns the checks off. A design tau did not
 * write (one the user replaced theirs with) has no style tau knows; the checks
 * that need one are skipped and the rest still run.
 */
export function designContextOf(designMd: string | null | undefined): CheckContext | null {
  if (!designMd) return null;
  const key = readDesignMeta(designMd)?.style;
  return isStyleKey(key) ? { style: STYLES[key] } : {};
}

export { DESIGN_PATH, designProse, syncDesignMd } from "./designMd";
export { directDesign, fallbackChoice } from "./director";
export { STYLES, ALL_STYLES, allFontPackages } from "./styles";
export {
  FEEL_PRESETS,
  describeDesign,
  normalizeDesignConfig,
  type DesignSummary,
} from "./config";
export type { DesignChoice, DesignConfig, StyleKey, StyleSpec } from "./types";
