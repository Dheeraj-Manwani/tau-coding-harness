/**
 * An app's design, from a choice to the two files that carry it.
 *
 * `DesignChoice` is the decision (which style, which accent, light or dark,
 * the three dials). `resolveDesign` fills in everything the decision implies —
 * the full palette for both modes — and `designFiles` writes it out as
 * `src/index.css`, which the app runs on, and `.tau/DESIGN.md`, which the
 * agent reads. Both are pure functions of the choice, so a restyle is the same
 * two calls with a different choice.
 *
 * See doc/CONTEXT_AND_MEMORY_PLAN.md §5.
 */
import type { Theme } from "../templates/theme";
import { buildDesignCss } from "./css";
import { renderDesignMd } from "./designMd";
import { buildTheme } from "./palette";
import { STYLES } from "./styles";
import type { DesignChoice, StyleSpec } from "./types";

export interface ResolvedDesign {
  style: StyleSpec;
  choice: DesignChoice;
  theme: Theme;
}

export function resolveDesign(choice: DesignChoice): ResolvedDesign {
  const style = STYLES[choice.style];
  return {
    style,
    choice,
    theme: buildTheme(style.palette, choice.accent, style.radius, {
      exact: choice.accentExact,
      mode: choice.mode,
    }),
  };
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
    designMd: renderDesignMd(design.style, design.choice, design.theme),
  };
}

export { DESIGN_PATH, designProse } from "./designMd";
export { directDesign, fallbackChoice } from "./director";
export { STYLES, ALL_STYLES, allFontPackages } from "./styles";
export type { DesignChoice, StyleKey, StyleSpec } from "./types";
