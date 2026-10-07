/**
 * The style library: every look tau can give an app.
 *
 * tau's own, written for this stack — Vite, Tailwind v4, the stock shadcn
 * components — rather than borrowed from a public skill or extracted from a
 * company's website. A shared skill becomes the next house style the moment it
 * is popular, and a look lifted from a brand is that brand's to object to
 * (doc/CONTEXT_AND_MEMORY_PLAN.md §5).
 */
import { STYLE_KEYS, type FontSet, type StyleKey, type StyleSpec } from "../types";
import { bento } from "./bento";
import { brutalist } from "./brutalist";
import { craft } from "./craft";
import { editorial } from "./editorial";
import { formal } from "./formal";
import { luxe } from "./luxe";
import { neon } from "./neon";
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
  craft,
  neon,
  formal,
};

export const ALL_STYLES: readonly StyleSpec[] = STYLE_KEYS.map((k) => STYLES[k]);

/** Every font package any style uses — what the sandbox image pre-loads. */
export function allFontPackages(): string[] {
  const pkgs = new Set<string>();
  for (const style of ALL_STYLES) {
    for (const fonts of fontSetsOf(style)) {
      for (const font of Object.values(fonts)) {
        if (font.pkg) pkgs.add(font.pkg);
      }
    }
  }
  return [...pkgs].sort();
}

/** The key of a style's own pairing, as opposed to one of its `fontOptions`. */
export const DEFAULT_FONTS = "default";

/** Every set of typefaces a style can be given: its own, then its options. */
export function fontSetsOf(style: StyleSpec): FontSet[] {
  return [style.fonts, ...style.fontOptions.map((o) => o.fonts)];
}

/** Whether `key` names one of the style's pairings. */
export function isFontPairing(style: StyleSpec, key: unknown): key is string {
  return key === DEFAULT_FONTS || style.fontOptions.some((o) => o.key === key);
}

/**
 * A pairing key as a design records it: one of the style's alternatives, or
 * nothing for the style's own — asked for by name or not asked for at all.
 */
export function chosenPairing(style: StyleSpec, key: unknown): string | undefined {
  return key !== DEFAULT_FONTS && isFontPairing(style, key) ? key : undefined;
}

/** The typefaces for a pairing key; the style's own for a key it does not have. */
export function fontsFor(style: StyleSpec, key: string | undefined): FontSet {
  return style.fontOptions.find((o) => o.key === key)?.fonts ?? style.fonts;
}

/** A pairing's name where someone chooses one: "Fraunces + Instrument Sans". */
export function fontLabel(fonts: FontSet): string {
  return fonts.display.name === fonts.body.name
    ? fonts.display.name
    : `${fonts.display.name} + ${fonts.body.name}`;
}
