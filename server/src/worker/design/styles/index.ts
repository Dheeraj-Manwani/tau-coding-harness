/**
 * The style library: every look tau can give an app.
 *
 * tau's own, written for this stack — Vite, Tailwind v4, the stock shadcn
 * components — rather than borrowed from a public skill or extracted from a
 * company's website. A shared skill becomes the next house style the moment it
 * is popular, and a look lifted from a brand is that brand's to object to
 * (doc/CONTEXT_AND_MEMORY_PLAN.md §5).
 */
import { STYLE_KEYS, type StyleKey, type StyleSpec } from "../types";
import { bento } from "./bento";
import { brutalist } from "./brutalist";
import { editorial } from "./editorial";
import { luxe } from "./luxe";
import { playful } from "./playful";
import { soft } from "./soft";
import { swiss } from "./swiss";
import { terminal } from "./terminal";
import { workbench } from "./workbench";

export const STYLES: Record<StyleKey, StyleSpec> = {
  editorial,
  swiss,
  brutalist,
  soft,
  terminal,
  bento,
  playful,
  luxe,
  workbench,
};

export const ALL_STYLES: readonly StyleSpec[] = STYLE_KEYS.map((k) => STYLES[k]);

/** Every font package any style uses — what the sandbox image pre-loads. */
export function allFontPackages(): string[] {
  const pkgs = new Set<string>();
  for (const style of ALL_STYLES) {
    for (const font of Object.values(style.fonts)) {
      if (font.pkg) pkgs.add(font.pkg);
    }
  }
  return [...pkgs].sort();
}
