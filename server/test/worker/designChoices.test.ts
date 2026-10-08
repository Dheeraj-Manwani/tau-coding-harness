import { describe, expect, test } from "bun:test";
import { applyThemeEdit, readThemeTokens } from "@/api/lib/themeEdit";
import { designConfigSchema } from "@/api/schemas/project.schema";
import { mergedConfig, npmPackageExists } from "@/api/services/design.service";
import { THEME_SWITCH_HTML, applyDesignTo, themeSwitchHtml, type DesignTarget } from "@/worker/design/apply";
import { SAMPLE_ACCENTS, designCatalog } from "@/worker/design/catalog";
import { checkPackageJson, checkStylesheet } from "@/worker/design/checks";
import { LAYOUTS } from "@/worker/design/layouts";
import { buildTheme } from "@/worker/design/palette";
import { contrast } from "@/worker/design/color";
import { hexToOklch, isHexColor } from "@/worker/design/color";
import {
  FEEL_PRESETS,
  MAX_IMPORTED_DESIGN_CHARS,
  describeDesign,
  normalizeDesignConfig,
} from "@/worker/design/config";
import {
  DESIGN_NOTES_MAX_CHARS,
  DESIGN_PATH,
  DESIGN_PROSE_MAX_CHARS,
  NOTES_HEADING,
  NOTES_INTRO,
  designProse,
  leadLayout,
  readDesignMeta,
  renderDesignMd,
  syncDesignMd,
  writtenLines,
} from "@/worker/design/designMd";
import {
  chooseFrom,
  directorPrompt,
  fallbackChoice,
  parseDirectorReply,
  settledNote,
  type DirectorOptions,
} from "@/worker/design/director";
import {
  fontSlug,
  importedMode,
  importedTokens,
  parseImportedDesign,
  splitFrontMatter,
} from "@/worker/design/importDesign";
import { designContextOf, designFiles, resolveDesign } from "@/worker/design";
import {
  carryOverCss,
  keptNotes,
  readOf,
  restyledChoice,
  topLevelStatements,
  withKeptNotes,
} from "@/worker/design/restyle";
import {
  ALL_STYLES,
  DEFAULT_FONTS,
  STYLES,
  allFontPackages,
  fontLabel,
  fontSetsOf,
  fontsFor,
  isFontPairing,
} from "@/worker/design/styles";
import { STYLE_GROUPS, STYLE_KEYS, type DesignChoice, type StyleKey } from "@/worker/design/types";

// A user can choose an app's look before it is built and change it afterwards
// (doc/CONTEXT_AND_MEMORY_PLAN.md §5, layer 2). Three rules run through all of
// it: what the user chose is never overridden, what they did not choose is
// still decided for them, and changing the look of an app never deletes what
// the app added to its own design.

const READ = "Reading this as: a neighbourhood bakery's site for locals, which should feel warm and unhurried.";

const choiceFor = (style: StyleKey, over: Partial<DesignChoice> = {}): DesignChoice => ({
  style,
  accent: "#c2410c",
  accentExact: false,
  mode: STYLES[style].defaultMode,
  dials: STYLES[style].dials,
  read: READ,
  source: "director",
  ...over,
});

const filesFor = (choice: DesignChoice) => designFiles(resolveDesign(choice), { fontsInstalled: true });

const offer = (over: Partial<DirectorOptions> = {}): DirectorOptions => ({
  styles: ["editorial", "craft", "soft"],
  accents: ["#b5532a", "#4d7c0f", "#0e7490"],
  accentExact: false,
  mode: "light",
  dials: { variance: 5, motion: 5, density: 5 },
  read: READ,
  ...over,
});

describe("the style library", () => {
  test("has twenty-eight styles, each a different silhouette", () => {
    expect(STYLE_KEYS).toHaveLength(28);
    expect(ALL_STYLES.map((s) => s.key)).toEqual([...STYLE_KEYS]);
    const silhouettes = new Set(
      ALL_STYLES.map((s) =>
        [s.skin.controlRadius, s.skin.cardRadius, s.skin.buttonCase, s.skin.field, s.skin.tabs, s.skin.borderWidth, s.fonts.display.name].join("|"),
      ),
    );
    expect(silhouettes.size).toBe(28);
  });

  test("every style offers two other font pairings, each different from its own", () => {
    for (const style of ALL_STYLES) {
      expect(style.fontOptions).toHaveLength(2);
      const labels = fontSetsOf(style).map(fontLabel);
      expect(new Set(labels).size).toBe(3);
      const keys = style.fontOptions.map((o) => o.key);
      expect(new Set(keys).size).toBe(2);
      for (const option of style.fontOptions) {
        expect(option.key).toMatch(/^[a-z][a-z0-9-]*$/);
        expect(option.key).not.toBe(DEFAULT_FONTS);
        expect(option.label.startsWith(option.fonts.display.name)).toBe(true);
      }
    }
  });

  test("every typeface on offer is a Fontsource package with files to import", () => {
    for (const style of ALL_STYLES) {
      for (const fonts of fontSetsOf(style)) {
        for (const font of [fonts.display, fonts.body]) {
          expect(font.pkg).toMatch(/^@fontsource(-variable)?\/[a-z0-9-]+$/);
          expect(font.imports!.length).toBeGreaterThan(0);
          expect(["Inter", "Roboto", "Arial", "Open Sans", "Geist"]).not.toContain(font.name);
        }
      }
    }
    // Options count toward what the library can install.
    expect(allFontPackages()).toContain("@fontsource-variable/playfair-display");
  });

  test("a pairing is looked up by key, and an unknown key means the style's own", () => {
    const { editorial } = STYLES;
    expect(fontsFor(editorial, "playfair").display.name).toBe("Playfair Display");
    expect(fontsFor(editorial, undefined)).toBe(editorial.fonts);
    expect(fontsFor(editorial, "no-such-pairing")).toBe(editorial.fonts);
    expect(isFontPairing(editorial, "playfair")).toBe(true);
    expect(isFontPairing(editorial, DEFAULT_FONTS)).toBe(true);
    // A pairing belongs to its style.
    expect(isFontPairing(STYLES.soft, "playfair")).toBe(false);
  });

  test("the new styles generate a stylesheet and a design file like any other", () => {
    for (const key of STYLE_KEYS.slice(9)) {
      const { css, designMd } = filesFor(choiceFor(key));
      expect(css).toContain(`the ${STYLES[key].name} style`);
      expect(css).toContain("@layer skin");
      expect(designMd).toContain(`# Design — ${STYLES[key].name}`);
      expect(designProse(designMd).length).toBeLessThan(6_500);
      expect(describeDesign(designMd)?.style).toBe(key);
    }
    expect(STYLES.neon.defaultMode).toBe("dark");
  });

  test("a display face with one weight is not asked for a bolder one", () => {
    // A font that ships only regular, set at 700, is smeared bold by the
    // browser. Where any pairing's display face is like that, the style's
    // headings, buttons and titles that use it have to be set at 400.
    for (const style of ALL_STYLES) {
      const oneWeight = fontSetsOf(style).some(
        (fonts) => fonts.display.imports?.length === 1 && fonts.display.imports[0]!.endsWith("/400.css"),
      );
      if (!oneWeight) continue;
      expect(style.baseCss).toContain("font-weight: 400;");
      expect(style.skin.cardTitleWeight).toBe("400");
      if (style.skin.buttonFont === "var(--font-heading)") expect(style.skin.buttonWeight).toBe("400");
      if (style.skin.badgeFont === "var(--font-heading)") expect(style.skin.badgeWeight).toBe("400");
    }
  });
});

describe("how the library is presented", () => {
  test("every style belongs to a family, and every family has styles", () => {
    const groups = STYLE_GROUPS.map((g) => g.key);
    expect(new Set(groups).size).toBe(groups.length);
    for (const style of ALL_STYLES) expect(groups).toContain(style.group);
    for (const group of groups) {
      expect(ALL_STYLES.filter((s) => s.group === group).length).toBeGreaterThanOrEqual(3);
    }
  });

  test("the looks people ask for by another name can be found under it", () => {
    const named = (aka: string) => ALL_STYLES.filter((s) => s.aka?.includes(aka)).map((s) => s.key);
    expect(named("Neo-brutalism")).toEqual(["brutalist"]);
    expect(named("Luxury typography")).toEqual(["luxe"]);
    expect(named("Bento grid")).toEqual(["bento"]);
    expect(named("Editorial design")).toEqual(["editorial"]);
    expect(named("Swiss design")).toEqual(["swiss"]);
    expect(named("Glassmorphism")).toEqual(["glass"]);
    expect(named("Claymorphism")).toEqual(["clay"]);
    expect(named("Neumorphism")).toEqual(["neumorphic"]);
    // No two styles answer to the same name, and none repeats its own.
    const all = ALL_STYLES.flatMap((s) => (s.aka ?? []).map((a) => a.toLowerCase()));
    expect(new Set(all).size).toBe(all.length);
    for (const s of ALL_STYLES) expect(s.aka ?? []).not.toContain(s.name);
  });

  test("the director is told those names, so a brief that uses one gets that style", () => {
    const prompt = directorPrompt("p");
    expect(prompt).toContain(`${STYLES.brutalist.avoid} Also called: Neo-brutalism, Neubrutalism.`);
    expect(prompt).toContain("Also called: Glassmorphism.");
    // A style with no other name says nothing about it.
    expect(prompt).toContain(`${STYLES.soft.avoid}\n`);
  });
});

describe("a style with a page backdrop", () => {
  const withBackdrop = ALL_STYLES.filter((s) => s.backdrop);

  test("glass has one: it is not glass without colour behind it", () => {
    expect(withBackdrop.map((s) => s.key)).toContain("glass");
    expect(STYLES.swiss.backdrop).toBeUndefined();
  });

  test("paints it behind the page, from the palette, and keeps the page wrapper from covering it", () => {
    for (const style of withBackdrop) {
      const { css, designMd } = filesFor(choiceFor(style.key));
      const base = css.slice(css.indexOf("@layer base"), css.indexOf("@layer skin"));
      expect(base).toContain("body::before {");
      expect(base).toContain("position: fixed;");
      expect(base).toContain("z-index: -1;");
      // Colour comes from the theme's variables, so it follows the accent,
      // the theme panel and both modes; nothing is written in as a literal.
      expect(style.backdrop).toContain("var(--");
      expect(style.backdrop).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|oklch\(/i);
      const skin = css.slice(css.indexOf("@layer skin"));
      expect(skin).toContain(".min-h-screen.bg-background");
      expect(skin).toContain("background-color: transparent;");
      // The agent is told, once, in the section about colour.
      expect(designProse(designMd).match(/The page has a backdrop/g)).toHaveLength(1);
    }
  });

  test("a style without one writes none of it", () => {
    const { css, designMd } = filesFor(choiceFor("swiss"));
    expect(css).not.toContain("body::before");
    expect(css).not.toContain(".min-h-screen.bg-background");
    expect(designMd).not.toContain("The page has a backdrop");
  });

  test("survives a restyle in both directions", () => {
    const plain = filesFor(choiceFor("workbench")).css;
    const glassy = filesFor(choiceFor("glass")).css;
    expect(carryOverCss(plain, glassy)).toBe(glassy);
    expect(carryOverCss(glassy, plain)).toBe(plain);
  });
});

describe("what a style adds to the stylesheet of its own", () => {
  test("leaves the palette where the theme panel and the checks expect it", () => {
    // Several styles define variables of their own for both modes. They must
    // not be mistaken for the palette, and the palette must still be found.
    for (const style of ALL_STYLES) {
      const choice = choiceFor(style.key);
      const { css } = filesFor(choice);
      const { theme } = resolveDesign(choice);
      expect(readThemeTokens(css).root["--background"]).toBe(theme.light.background);
      expect(readThemeTokens(css).dark["--primary"]).toBe(theme.dark.primary);
      expect(checkStylesheet(css)).toEqual([]);
    }
  });

  test("its rules for tabs are written to outrank the shared ones", () => {
    // The shared skin addresses a tab bar by its orientation too, so a style's
    // rule keyed on the slot alone loses to it for anything the shared rule
    // also sets — which is how three styles once described an accent-coloured
    // active tab that was never drawn.
    for (const style of ALL_STYLES) {
      for (const line of style.skinCss.split("\n")) {
        if (!/^\s*\[data-slot="tabs-(list|trigger)"\]/.test(line)) continue;
        expect(line).not.toMatch(/background|border-bottom-color|(?<![-\w])color:|box-shadow|border-radius/);
      }
    }
  });
});

describe("the catalog someone chooses from", () => {
  const catalog = designCatalog();

  test("lists every style with what a picker needs and nothing it does not", () => {
    expect(catalog.styles.map((s) => s.key)).toEqual([...STYLE_KEYS]);
    for (const style of catalog.styles) {
      expect(Object.keys(style).sort()).toEqual(
        ["aka", "defaultMode", "dials", "fonts", "group", "key", "look", "name", "outlined", "page", "sampleAccent", "suits", "swatch"].sort(),
      );
      expect(catalog.groups.map((g) => g.key)).toContain(style.group);
      expect(style.fonts[0]!.key).toBe(DEFAULT_FONTS);
      expect(style.fonts).toHaveLength(3);
      for (const colour of Object.values(style.swatch)) expect(isHexColor(colour)).toBe(true);
    }
  });

  test("says what page an accent will sit on, so the picker can warn about one that will not show", () => {
    for (const style of catalog.styles) {
      expect(isHexColor(style.page.light)).toBe(true);
      expect(isHexColor(style.page.dark)).toBe(true);
      // A light page and a dark one, whatever the style.
      expect(hexToOklch(style.page.light).l).toBeGreaterThan(0.8);
      expect(hexToOklch(style.page.dark).l).toBeLessThan(0.35);
      expect(style.page[style.defaultMode]).toBe(style.swatch.background);
      expect(style.outlined).toBe(STYLES[style.key].palette.fencedPrimary === true);
    }
    expect(catalog.styles.some((s) => s.outlined)).toBe(true);
  });

  test("names the families in the order they are shown, each with a short and a full name", () => {
    expect(catalog.groups).toEqual(STYLE_GROUPS.map((g) => ({ key: g.key, label: g.label, title: g.title })));
    expect(catalog.styles.find((s) => s.key === "brutalist")!.aka).toEqual(["Neo-brutalism", "Neubrutalism"]);
    expect(catalog.styles.find((s) => s.key === "soft")!.aka).toEqual([]);
  });

  test("each style has an accent that shows it off, and the feel presets are whole", () => {
    expect(Object.keys(SAMPLE_ACCENTS).sort()).toEqual([...STYLE_KEYS].sort());
    expect(Object.keys(catalog.feelPresets)).toEqual(["calm", "balanced", "bold"]);
    expect(catalog.feelPresets.calm.motion).toBeLessThan(catalog.feelPresets.bold.motion);
    expect(catalog.suggestedAccents.length).toBeGreaterThanOrEqual(8);
    expect(FEEL_PRESETS.balanced).toEqual({ variance: 5, motion: 5, density: 5 });
  });
});

describe("what a user chose", () => {
  test("is kept, tidied", () => {
    expect(
      normalizeDesignConfig({
        style: "editorial", accent: "#ABC", mode: "dark", fonts: "playfair",
        dials: { variance: 12, motion: "3", density: 0 },
      }),
    ).toEqual({
      style: "editorial", accent: "#aabbcc", mode: "dark", fonts: "playfair",
      dials: { variance: 10, motion: 3, density: 1 },
    });
  });

  test("anything unusable is dropped rather than refused", () => {
    expect(
      normalizeDesignConfig({ style: "vaporwave", accent: "red", mode: "sepia", fonts: 7, dials: { variance: "lots" } }),
    ).toBeNull();
    expect(normalizeDesignConfig({ style: "soft", accent: "not a colour" })).toEqual({ style: "soft" });
  });

  test("nothing chosen is the same as never choosing", () => {
    for (const nothing of [null, undefined, {}, [], "editorial", { dials: {} }, { designMd: "   " }]) {
      expect(normalizeDesignConfig(nothing)).toBeNull();
    }
  });

  test("a font pairing means nothing without the style it belongs to", () => {
    expect(normalizeDesignConfig({ fonts: "playfair" })).toBeNull();
    expect(normalizeDesignConfig({ style: "soft", fonts: "playfair" })).toEqual({ style: "soft" });
    // The style's own pairing, asked for by name, is kept: it is how a
    // restyle goes back to it.
    expect(normalizeDesignConfig({ style: "soft", fonts: DEFAULT_FONTS })).toEqual({ style: "soft", fonts: DEFAULT_FONTS });
    expect(chooseFrom(offer(), "p", { style: "soft", fonts: DEFAULT_FONTS }).fonts).toBeUndefined();
  });

  test("an imported file is kept whole, up to a limit", () => {
    expect(normalizeDesignConfig({ designMd: "  # Mine\nBlue.  " })).toEqual({ designMd: "# Mine\nBlue." });
    const long = normalizeDesignConfig({ designMd: "x".repeat(MAX_IMPORTED_DESIGN_CHARS + 500) })!;
    expect(long.designMd).toHaveLength(MAX_IMPORTED_DESIGN_CHARS);
  });

  test("the request shape accepts a full choice and refuses a malformed one", () => {
    const full = { style: "neon", accent: "#d63cff", mode: "dark", fonts: "exo", dials: { motion: 9 } };
    expect(designConfigSchema.safeParse(full).success).toBe(true);
    expect(designConfigSchema.safeParse({}).success).toBe(true);
    expect(designConfigSchema.safeParse({ style: "vaporwave" }).success).toBe(false);
    expect(designConfigSchema.safeParse({ accent: "red" }).success).toBe(false);
    expect(designConfigSchema.safeParse({ dials: { motion: 11 } }).success).toBe(false);
    expect(designConfigSchema.safeParse({ designMd: "a\0b" }).success).toBe(false);
  });
});

describe("deciding a design when the user has chosen part of it", () => {
  test("a chosen style is the style, whatever the director would have picked", () => {
    for (let i = 0; i < 20; i++) {
      const choice = chooseFrom(offer(), `p${i}`, { style: "brutalist" });
      expect(choice.style).toBe("brutalist");
      expect(choice.source).toBe("user");
      // The rest still comes from the director's reading of the brief.
      expect(offer().accents).toContain(choice.accent);
      expect(choice.read).toBe(READ);
    }
  });

  test("a chosen colour is used exactly, not fitted to the style", () => {
    const choice = chooseFrom(offer(), "p", { accent: "#1db954" });
    expect(choice.accent).toBe("#1db954");
    expect(choice.accentExact).toBe(true);
    expect(resolveDesign(choice).theme[choice.mode].primary).toBe("#1db954");
  });

  test("a chosen dial is taken as given; an unchosen one is still blended with the style's", () => {
    const choice = chooseFrom(
      offer({ styles: ["editorial"], dials: { variance: 3, motion: 9, density: 9 } }),
      "p",
      { dials: { motion: 9 } },
    );
    expect(choice.dials.motion).toBe(9);
    const own = STYLES.editorial.dials;
    expect(choice.dials.variance).toBe(Math.round((3 + own.variance) / 2));
    expect(choice.dials.density).toBe(Math.round((9 + own.density) / 2));
  });

  test("a chosen mode and font pairing are honoured; a pairing of another style is not", () => {
    const choice = chooseFrom(offer(), "p", { style: "editorial", mode: "dark", fonts: "playfair" });
    expect(choice.mode).toBe("dark");
    expect(choice.fonts).toBe("playfair");
    expect(resolveDesign(choice).style.fonts.display.name).toBe("Playfair Display");
    expect(chooseFrom(offer(), "p", { style: "soft", fonts: "playfair" }).fonts).toBeUndefined();
  });

  test("with nothing chosen it is the director's decision, as before", () => {
    const choice = chooseFrom(offer(), "p1");
    expect(choice.source).toBe("director");
    expect(choice.fonts).toBeUndefined();
    expect(choice).toEqual(chooseFrom(offer(), "p1", {}));
  });

  test("when the director cannot be reached, the user's choices still stand", () => {
    const choice = fallbackChoice("p1", { style: "luxe", accent: "#c8a45c", dials: { density: 2 } });
    expect(choice.style).toBe("luxe");
    expect(choice.accent).toBe("#c8a45c");
    expect(choice.accentExact).toBe(true);
    expect(choice.mode).toBe("dark");
    expect(choice.dials).toEqual({ ...STYLES.luxe.dials, density: 2 });
    expect(choice.source).toBe("user");
    expect(fallbackChoice("p1").source).toBe("fallback");
  });

  test("the director is told what is settled, so the rest suits it", () => {
    expect(settledNote({})).toBe("");
    const note = settledNote({ style: "terminal", accent: "#39d98a", mode: "dark" });
    expect(note).toContain('has chosen the style "terminal"');
    expect(note).toContain("List only that style");
    expect(note).toContain("#39d98a");
    expect(note).toContain("dark mode");
    // A colour is used exactly as chosen, so with light or dark left open the
    // director is asked to pick the one the colour shows against.
    expect(note).not.toContain("stands out against");
    expect(settledNote({ accent: "#14213d" })).toContain("choose the one this colour stands out against");
  });
});

// ── A design the user brought ────────────────────────────────────────────────

const THEIRS = `---
version: alpha
name: "Harbour"
colors:
  primary: "#0B5FFF"
  on-primary: "#ffffff"
  background: "#0f1115"
  on-background: "#E8EAED"
  surface: "#171a21"
  outline: "#2a2f3a"
  surface-variant: "#1f232c"
  on-surface-variant: "#9aa3b2"
  error: "#ff5d5d"
  tertiary: "not-a-colour"
typography:
  headline:
    fontFamily: "Playfair Display", Georgia, serif
    fontWeight: 600
  body:
    fontFamily: Albert Sans
    fontSize: 1rem
  code:
    fontFamily: ui-monospace
rounded:
  sm: 2px
  md: 6px
  full: 9999px
---

# Harbour

## Overview
Calm, nautical and precise. Deep navy surfaces with one electric blue.

## Rules
- Never use gradients.
- Photographs are full-bleed.
`;

describe("reading a DESIGN.md the user brought", () => {
  test("takes the colours it recognises, under whatever names the file uses", () => {
    const { tokens } = parseImportedDesign(THEIRS);
    expect(tokens.colors).toEqual({
      primary: "#0b5fff",
      "primary-foreground": "#ffffff",
      background: "#0f1115",
      foreground: "#e8eaed",
      card: "#171a21",
      border: "#2a2f3a",
      muted: "#1f232c",
      "muted-foreground": "#9aa3b2",
      destructive: "#ff5d5d",
    });
  });

  test("takes font families by role, and a base radius", () => {
    const { tokens } = parseImportedDesign(THEIRS);
    // A generic family is not a typeface to install.
    expect(tokens.fonts).toEqual({ display: "Playfair Display", body: "Albert Sans" });
    expect(tokens.radius).toBe("6px");
    expect(fontSlug("Playfair Display")).toBe("playfair-display");
    expect(fontSlug("  Söhne Breit ")).toBe("sohne-breit");
  });

  test("knows a dark page from a light one", () => {
    expect(importedMode(parseImportedDesign(THEIRS).tokens)).toBe("dark");
    expect(importedMode(importedTokens('colors:\n  background: "#fffdf8"'))).toBe("light");
    expect(importedMode(importedTokens(null))).toBeNull();
  });

  test("a file with no front matter, or none it can read, still imports — as prose only", () => {
    const plain = parseImportedDesign("# My design\n\nUse lots of white space.");
    expect(plain.tokens).toEqual({ colors: {}, fonts: {} });
    expect(plain.text).toContain("lots of white space");
    expect(parseImportedDesign("---\n: : :\n- a list\n---\nText").tokens).toEqual({ colors: {}, fonts: {} });
    expect(splitFrontMatter("---\nnever closed").front).toBeNull();
  });

  test("an accent with no primary is the brand colour", () => {
    expect(importedTokens('colors:\n  accent: "#ff0066"').colors.primary).toBe("#ff0066");
  });
});

describe("an app built around an imported design", () => {
  const imported = parseImportedDesign(THEIRS);
  const choice = chooseFrom(offer({ styles: ["swiss", "formal"], mode: "light" }), "p", {}, imported);

  test("gets the closest style, the file's own accent and its own light or dark", () => {
    expect(choice.style).toBe("swiss");
    expect(choice.accent).toBe("#0b5fff");
    expect(choice.accentExact).toBe(true);
    // The file's page is dark, whatever the director thought.
    expect(choice.mode).toBe("dark");
    expect(choice.source).toBe("import");
  });

  test("the director is shown the file's prose, not its tokens", () => {
    const note = settledNote({}, imported);
    expect(note).toContain("<their_design>");
    expect(note).toContain("Calm, nautical and precise.");
    expect(note).not.toContain("on-primary");
  });

  test("its colours become the palette the app opens in", () => {
    const { theme } = resolveDesign(choice);
    expect(theme.dark.primary).toBe("#0b5fff");
    expect(theme.dark.background).toBe("#0f1115");
    expect(theme.dark.foreground).toBe("#e8eaed");
    expect(theme.dark.card).toBe("#171a21");
    expect(theme.dark.popover).toBe("#171a21");
    expect(theme.dark.border).toBe("#2a2f3a");
    expect(theme.dark["muted-foreground"]).toBe("#9aa3b2");
    expect(theme.radius).toBe("6px");
    // The other mode keeps the style's own rendering.
    expect(theme.light.background).not.toBe("#0f1115");
  });

  test("the design file is theirs, with tau's notes on how it was built in ahead of it", () => {
    const { designMd, css } = filesFor(choice);
    expect(designMd.startsWith('---\nversion: alpha\nname: "Harbour"')).toBe(true);
    expect(readDesignMeta(designMd)).toMatchObject({ style: "swiss", mode: "dark", source: "import" });
    const prose = designProse(designMd);
    expect(prose.indexOf("## In this app")).toBeLessThan(prose.indexOf("# Harbour"));
    expect(prose).toContain("based on tau's Swiss style");
    expect(prose).toContain("- The accent is `#0b5fff`");
    expect(prose).toContain("Colour only through tokens");
    expect(prose).toContain("- Never use gradients.");
    expect(css).toContain("--primary: #0b5fff;");
    expect(describeDesign(designMd)).toMatchObject({ style: "swiss", imported: true });
    // Its typefaces are reported as the file's own once they are installed.
    const withTheirFonts = designFiles(
      resolveDesign(choice, {
        ...STYLES.swiss.fonts,
        display: { name: "Playfair Display", stack: '"Playfair Display Variable", serif' },
        body: { name: "Albert Sans", stack: '"Albert Sans Variable", sans-serif' },
      }),
      { fontsInstalled: true },
    ).designMd;
    expect(describeDesign(withTheirFonts)!.fontsLabel).toBe("Playfair Display + Albert Sans");
    // The checks still know which style's skin the app has.
    expect(designContextOf(designMd)).toEqual({ style: STYLES.swiss });
  });

  test("a user's own style or colour still outranks the file", () => {
    const overridden = chooseFrom(offer(), "p", { style: "luxe", accent: "#c8a45c", mode: "light" }, imported);
    expect(overridden.style).toBe("luxe");
    expect(overridden.accent).toBe("#c8a45c");
    expect(overridden.mode).toBe("light");
  });
});

// ── Putting a design into an app ─────────────────────────────────────────────

const BUTTON = `function Button({ variant, size, ...props }) {
  return (
    <button
      data-slot="button"
      {...props}
    />
  );
}`;

/** An app as a bag of files, with a record of what was installed. */
function fakeApp(
  files: Record<string, string>,
  opts: {
    installsNow?: boolean;
    available?: (pkg: string) => boolean;
    /** What a lookup of the package says, for an app that cannot install. */
    published?: (pkg: string) => boolean;
  } = {},
) {
  const installed: string[][] = [];
  const target: DesignTarget = {
    installsNow: opts.installsNow ?? true,
    ...(opts.published ? { packageExists: async (pkg: string) => opts.published!(pkg) } : {}),
    read: async (path) => files[path] ?? null,
    write: async (path, content) => {
      files[path] = content;
    },
    addPackages: async (packages) => {
      installed.push(packages);
      if (!packages.every(opts.available ?? (() => true))) return { ok: false, detail: "404" };
      const pkg = JSON.parse(files["package.json"] ?? "{}") as { dependencies?: Record<string, string> };
      pkg.dependencies = { ...pkg.dependencies, ...Object.fromEntries(packages.map((p) => [p, "^5.0.0"])) };
      files["package.json"] = JSON.stringify(pkg);
      return { ok: true };
    },
  };
  return { files, installed, target };
}

const freshApp = () => ({
  "package.json": JSON.stringify({ dependencies: { react: "^19.0.0" } }),
  "index.html": '<html lang="en"><body></body></html>',
  "src/components/ui/button.tsx": BUTTON,
  "src/index.css": '@import "tailwindcss";\n',
});

describe("applying a design", () => {
  test("installs the chosen pairing's fonts, not the style's default ones", async () => {
    const app = fakeApp(freshApp());
    const result = await applyDesignTo(app.target, choiceFor("editorial", { fonts: "playfair" }));
    expect(result).toEqual({ applied: true, fontsInstalled: true, skipped: [] });
    expect(app.installed).toEqual([["@fontsource-variable/playfair-display", "@fontsource-variable/karla"]]);
    expect(app.files["src/index.css"]).toContain('@import "@fontsource-variable/playfair-display";');
    expect(app.files["src/index.css"]).not.toContain("fraunces");
    expect(app.files[DESIGN_PATH]).toContain("**Playfair Display**");
    expect(readDesignMeta(app.files[DESIGN_PATH]!)!.fonts).toBe("playfair");
    expect(app.files["index.html"]).not.toContain("dark");
    expect(app.files["src/components/ui/button.tsx"]).toContain("data-variant={variant}");
  });

  test("an imported design's fonts are used where they can be installed, and fall back where they cannot", async () => {
    const imported = parseImportedDesign(THEIRS);
    const choice = chooseFrom(offer({ styles: ["swiss"] }), "p", {}, imported);
    const app = fakeApp(freshApp(), { available: (pkg) => !pkg.includes("playfair") });
    const result = await applyDesignTo(app.target, choice);
    expect(result.applied).toBe(true);
    expect(result.skipped).toEqual(["font Playfair Display (not available)"]);
    const css = app.files["src/index.css"]!;
    expect(css).toContain(`--font-sans: "Albert Sans Variable", ${STYLES.swiss.fonts.body.stack.split(", ").slice(1).join(", ")};`);
    // The heading font could not be had: the style's own stands in.
    expect(css).toContain(`--font-heading: ${STYLES.swiss.fonts.display.stack};`);
    expect(app.files[DESIGN_PATH]).toContain("text is **Albert Sans** (`font-sans`)");
    expect(app.files["index.html"]).toContain('class="dark"');
  });

  test("where an install cannot be checked, an imported font is not attempted", async () => {
    const imported = parseImportedDesign(THEIRS);
    const choice = chooseFrom(offer({ styles: ["swiss"] }), "p", {}, imported);
    const app = fakeApp(freshApp(), { installsNow: false });
    await applyDesignTo(app.target, choice);
    expect(app.installed.flat().some((p) => p.includes("playfair") || p.includes("albert"))).toBe(false);
    expect(app.files["src/index.css"]).toContain(`--font-sans: ${STYLES.swiss.fonts.body.stack};`);
  });

  test("an app that is not running still gets an imported font, once it is known to exist", async () => {
    const imported = parseImportedDesign(THEIRS);
    const choice = chooseFrom(offer({ styles: ["swiss"] }), "p", {}, imported);
    const app = fakeApp(freshApp(), { installsNow: false, published: (pkg) => pkg.includes("albert") });
    const result = await applyDesignTo(app.target, choice);
    // Looked up, found, and added; the one that was not found is not added.
    expect(app.installed.flat()).toContain("@fontsource-variable/albert-sans");
    expect(app.installed.flat().some((p) => p.includes("playfair"))).toBe(false);
    expect(result.skipped).toEqual(["font Playfair Display (not available)"]);
    expect(app.files["src/index.css"]).toContain('--font-sans: "Albert Sans Variable"');
    expect(app.files["src/index.css"]).toContain(`--font-heading: ${STYLES.swiss.fonts.display.stack};`);
  });

  test("a package is looked up by name, and any doubt is a no", async () => {
    const asked: string[] = [];
    const answering = (status: number) =>
      (async (url: string | URL | Request) => {
        asked.push(String(url));
        return new Response(null, { status });
      }) as typeof fetch;
    expect(await npmPackageExists("@fontsource-variable/albert-sans", answering(200))).toBe(true);
    expect(asked).toEqual(["https://registry.npmjs.org/@fontsource-variable%2falbert-sans"]);
    expect(await npmPackageExists("@fontsource-variable/no-such-face", answering(404))).toBe(false);
    expect(await npmPackageExists("@fontsource-variable/albert-sans", answering(503))).toBe(false);
    const failing = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await npmPackageExists("@fontsource-variable/albert-sans", failing)).toBe(false);
    // Never a name that is not a package name: it would end up in package.json.
    asked.length = 0;
    expect(await npmPackageExists("../../etc/passwd", answering(200))).toBe(false);
    expect(await npmPackageExists("@fontsource-variable/a b", answering(200))).toBe(false);
    expect(asked).toEqual([]);
  });

  test("fonts that fail to install cost the fonts, not the design", async () => {
    const app = fakeApp(freshApp(), { available: () => false });
    const result = await applyDesignTo(app.target, choiceFor("soft"));
    expect(result.applied).toBe(true);
    expect(result.fontsInstalled).toBe(false);
    expect(app.files["src/index.css"]).not.toContain("@fontsource");
    expect(app.files["src/index.css"]).toContain("@layer skin");
  });
});

// ── Changing the look of an app that exists ──────────────────────────────────

describe("the design to change to", () => {
  const md = filesFor(choiceFor("editorial", { accent: "#a4442a", dials: { variance: 6, motion: 3, density: 2 }, fonts: "playfair" })).designMd;
  const current = describeDesign(md)!;

  test("an app's design is read back from its own file", () => {
    expect(current).toEqual({
      style: "editorial", styleName: "Editorial", accent: "#a4442a", mode: "light",
      dials: { variance: 6, motion: 3, density: 2 }, fonts: "playfair",
      fontsLabel: "Playfair Display + Karla", imported: false,
      switch: false, neutral: null,
    });
    expect(readOf(md)).toBe(READ);
    expect(describeDesign("# Someone else's design")).toBeNull();
    expect(describeDesign(null)).toBeNull();
  });

  test("only what was asked for changes", () => {
    const next = restyledChoice(current, { accent: "#0e7490" }, readOf(md), "p");
    expect(next).toMatchObject({
      style: "editorial", accent: "#0e7490", accentExact: true, mode: "light",
      dials: { variance: 6, motion: 3, density: 2 }, fonts: "playfair", read: READ, source: "user",
    });
  });

  test("a new style brings its own mode, dials and typefaces; the colour carries over, refitted", () => {
    const next = restyledChoice(current, { style: "neon" }, readOf(md), "p");
    expect(next.style).toBe("neon");
    expect(next.mode).toBe("dark");
    expect(next.dials).toEqual(STYLES.neon.dials);
    expect(next.fonts).toBeUndefined();
    expect(next.accent).toBe("#a4442a");
    expect(next.accentExact).toBe(false);
    expect(next.read).toBe(READ);
  });

  test("what the user says outranks what the new style would bring", () => {
    const next = restyledChoice(current, { style: "neon", mode: "light", dials: { motion: 2 }, fonts: "exo" }, readOf(md), "p");
    expect(next.mode).toBe("light");
    expect(next.dials).toEqual({ ...STYLES.neon.dials, motion: 2 });
    expect(next.fonts).toBe("exo");
  });

  test("going back to the style's own fonts is a choice too", () => {
    // The app has Playfair; asking for the style's own pairing by name drops it.
    const back = restyledChoice(current, { style: "editorial", fonts: DEFAULT_FONTS }, readOf(md), "p");
    expect(back.fonts).toBeUndefined();
    expect(resolveDesign(back).style.fonts).toBe(STYLES.editorial.fonts);
    // Not asking keeps what the app has.
    expect(restyledChoice(current, { style: "editorial" }, readOf(md), "p").fonts).toBe("playfair");
  });
});

describe("what is recorded as the user's choice after a restyle", () => {
  const before = { style: "neon", accent: "#0e7490", mode: "dark", fonts: "exo", dials: { variance: 8, motion: 8, density: 5 } } as const;

  test("a new choice goes on top of the old ones", () => {
    expect(mergedConfig(before, { accent: "#be123c" }, "neon", false)).toEqual({ ...before, accent: "#be123c" });
    expect(mergedConfig(before, { dials: { motion: 2 } }, "neon", false).dials).toEqual({ variance: 8, motion: 2, density: 5 });
    expect(mergedConfig(null, { style: "soft" }, "soft", true)).toEqual({ style: "soft" });
  });

  test("a different style drops what belonged to the old one", () => {
    // Light or dark, the dials and the font pairing came with Neon; the colour did not.
    expect(mergedConfig(before, { style: "craft" }, "craft", true)).toEqual({ style: "craft", accent: "#0e7490" });
    // Unless this request says them again.
    expect(mergedConfig(before, { style: "craft", mode: "dark", dials: { density: 2 } }, "craft", true)).toEqual({
      style: "craft", accent: "#0e7490", mode: "dark", dials: { density: 2 },
    });
  });

  test("choosing a style of tau's replaces a design that was imported", () => {
    const imported = { designMd: "# Mine" };
    expect(mergedConfig(imported, { style: "soft" }, "soft", true)).toEqual({ style: "soft" });
    expect(mergedConfig(imported, { accent: "#be123c" }, "luxe", false)).toEqual({ designMd: "# Mine", accent: "#be123c" });
  });
});

describe("what a restyle keeps of the old design file", () => {
  const original = filesFor(choiceFor("workbench", { accent: "#7a8b5a" })).designMd;
  const noted = (md: string, ...lines: string[]) => `${md.trimEnd()}\n${lines.join("\n")}\n`;

  test("a file nobody has added to has nothing to keep", () => {
    expect(original).toContain(`\n${NOTES_HEADING}\n${NOTES_INTRO}\n`);
    expect(writtenLines(original)!.size).toBeGreaterThan(30);
    expect(keptNotes(original)).toEqual([]);
    expect(keptNotes(null)).toEqual([]);
    expect(withKeptNotes(original, [])).toBe(original);
  });

  test("the notes section is the app's, and is kept whole", () => {
    // Written at the very end of the file, after tau's own last line, which is
    // where an agent appending to the file puts it.
    const edited = noted(original, "- The logo is always green.", "- The sale banner may use purple.");
    expect(keptNotes(edited)).toEqual(["- The logo is always green.", "- The sale banner may use purple."]);
  });

  test("lines added anywhere else are kept too, wherever they were put", () => {
    const edited = original
      .replace("## Typography\n", "## Typography\n- **Pacifico** — `font-fun`. The promo banner's headline only.\n")
      .replace("## Do's and Don'ts\n", "## Do's and Don'ts\n- **Promo banner exception.** The home page banner uses purple to pink, as the user asked.\n")
      .replace(`${NOTES_HEADING}\n`, `## Brand\nThe logo is always green.\n\n${NOTES_HEADING}\n`);
    expect(keptNotes(edited)).toEqual([
      "- **Pacifico** — `font-fun`. The promo banner's headline only.",
      "- **Promo banner exception.** The home page banner uses purple to pink, as the user asked.",
      "## Brand",
      "The logo is always green.",
    ]);
  });

  test("values the theme panel changed are not mistaken for notes", () => {
    const recoloured = syncDesignMd(original, { "--primary": "#123456", "--background": "#fefefe", "--foreground": "#111111" });
    expect(recoloured).not.toBe(original);
    expect(keptNotes(recoloured)).toEqual([]);
  });

  test("they go into the new file's notes, and survive the restyle after that", () => {
    const notes = ["- **Promo banner exception.** Purple to pink.", "## Brand", "The logo is always green."];
    const restyled = withKeptNotes(filesFor(choiceFor("brutalist")).designMd, notes);
    expect(describeDesign(restyled)?.style).toBe("brutalist");
    // One notes section, with a heading that was a section of its own set a
    // level down so that it stays inside it.
    expect(restyled.match(/^## Notes for this app$/gm)).toHaveLength(1);
    expect(restyled).toContain(`${NOTES_INTRO}\n\n- **Promo banner exception.** Purple to pink.\n### Brand\nThe logo is always green.\n`);
    // The agent is sent them, and not tau's bookkeeping.
    expect(designProse(restyled)).toContain("The logo is always green.");
    expect(designProse(restyled)).not.toContain("<!--");
    // Restyle again: the notes are still notes, and are not doubled.
    const carried = ["- **Promo banner exception.** Purple to pink.", "### Brand", "The logo is always green."];
    expect(keptNotes(restyled)).toEqual(carried);
    const again = withKeptNotes(filesFor(choiceFor("soft")).designMd, keptNotes(restyled));
    expect(again.match(/^## Notes for this app$/gm)).toHaveLength(1);
    expect(keptNotes(again)).toEqual(carried);
  });

  test("a note outlives a change to tau's own wording for the style", () => {
    // The file as an older tau would have written it: one sentence of the
    // style has since been reworded, so it is not what tau would write today.
    // The file's own record says the old sentence was tau's.
    const reworded = { ...STYLES.workbench, prose: { ...STYLES.workbench.prose, shapes: "An older sentence about corners." } };
    const choice = choiceFor("workbench", { accent: "#7a8b5a" });
    const older = renderDesignMd(reworded, choice, resolveDesign(choice).theme);
    expect(older).toContain("An older sentence about corners.");
    expect(keptNotes(older)).toEqual([]);
    const edited = older.replace("## Typography\n", "## Typography\n- **Pacifico** — the promo banner only.\n");
    expect(keptNotes(edited)).toEqual(["- **Pacifico** — the promo banner only."]);
  });

  test("a file with no record of tau's lines keeps its notes and whole foreign sections", () => {
    // What is left when an agent rewrites the file from scratch, or when the
    // file was written before tau kept a record.
    const bare = noted(original.replace(/^<!-- tau-lines:.*\n/m, ""), "- The logo is always green.")
      .replace("## Shapes\n", "## Shapes\nA sentence somebody slipped in.\n")
      .replace(`${NOTES_HEADING}\n`, `## Brand\nNo stock photos.\n\n## Kept from the previous design\n- An older note.\n\n${NOTES_HEADING}\n`);
    expect(writtenLines(bare)).toBeNull();
    expect(keptNotes(bare)).toEqual(["- The logo is always green.", "## Brand", "No stock photos.", "", "- An older note."]);
  });

  test("an imported design keeps nothing of tau's, only sections tau never writes", () => {
    const imported = filesFor(chooseFrom(offer({ styles: ["swiss"] }), "p", {}, parseImportedDesign(THEIRS))).designMd;
    // Their file is one whole foreign document; its sections are theirs.
    expect(keptNotes(imported)).toContain("- Never use gradients.");
    expect(keptNotes(imported).join("\n")).not.toContain("In this app");
    // It has a notes section of its own, and what is put there is kept.
    expect(imported).toContain(`\n${NOTES_HEADING}\n${NOTES_INTRO}\n`);
    expect(keptNotes(noted(imported, "- The logo is always green."))[0]).toBe("- The logo is always green.");
  });

  test("a long file is cut for the agent, but never through its notes", () => {
    const filler = Array.from({ length: 200 }, (_, i) => `Sentence ${i} of somebody's long design.`).join("\n");
    const long = noted(original.replace("## Layout\n", `## Layout\n${filler}\n`), "- The logo is always green.");
    const prose = designProse(long);
    expect(prose).toContain("is cut here to save space");
    expect(prose.trimEnd().endsWith(`${NOTES_HEADING}\n- The logo is always green.`)).toBe(true);
    expect(prose.length).toBeLessThan(DESIGN_PROSE_MAX_CHARS + DESIGN_NOTES_MAX_CHARS + 300);
  });
});

describe("what a restyle keeps of the old stylesheet", () => {
  const before = filesFor(choiceFor("workbench", { accent: "#7a8b5a" })).css;
  const after = filesFor(choiceFor("brutalist", { accent: "#7a8b5a" })).css;

  test("a stylesheet nobody has added to is simply replaced", () => {
    expect(carryOverCss(before, after)).toBe(after);
  });

  test("statements are found at the top level, past comments, strings and nesting", () => {
    const heads = topLevelStatements(
      '@import "a";\n/* } not an end */\n:root { --x: "}"; }\n@layer skin { .a { b: c; } }\n.promo::after { content: "{"; }',
    ).map((s) => s.head);
    expect(heads).toEqual(['@import "a"', ":root", "@layer skin", ".promo::after"]);
  });

  test("variables the app added to a palette or the theme block are carried over", () => {
    const edited = before
      .replace(":root {\n", ":root {\n  --promo-from: #6d28d9;\n")
      .replace(".dark {\n", ".dark {\n  --promo-from: #a78bfa;\n")
      .replace("@theme inline {\n", "@theme inline {\n  --color-promo-from: var(--promo-from);\n  --font-fun: \"Pacifico\", cursive;\n");
    const merged = carryOverCss(edited, after);
    const palettes = topLevelStatements(merged);
    const body = (head: string) => palettes.find((s) => s.head === head)!.body!;
    expect(body(":root")).toContain("--promo-from: #6d28d9;");
    expect(body(".dark")).toContain("--promo-from: #a78bfa;");
    expect(body("@theme inline")).toContain("--color-promo-from: var(--promo-from);");
    expect(body("@theme inline")).toContain('--font-fun: "Pacifico", cursive;');
    // The theme panel can still find and edit the palette.
    expect(readThemeTokens(merged).root["--primary"]).toBe(readThemeTokens(after).root["--primary"]);
    expect(applyThemeEdit({ content: merged, name: "--primary", value: "#112233", scope: "root" }).ok).toBe(true);
  });

  test("tau's own variables are not carried: those are the old look", () => {
    const merged = carryOverCss(before.replace(/--primary: #[0-9a-f]{6};/, "--primary: #ff0000;"), after);
    expect(merged).toBe(after);
    expect(merged).not.toContain("#ff0000");
  });

  test("a font the app imported stays imported; the old style's own fonts do not", () => {
    const edited = before.replace('@import "shadcn/tailwind.css";\n', '@import "shadcn/tailwind.css";\n@import "@fontsource/pacifico";\n');
    const merged = carryOverCss(edited, after);
    expect(merged).toContain('@import "@fontsource/pacifico";');
    expect(merged).not.toContain("ibm-plex-sans");
    // Imports stay ahead of everything else.
    expect(merged.indexOf("@fontsource/pacifico")).toBeLessThan(merged.indexOf("@custom-variant"));
  });

  test("rules of the app's own are kept; the old skin and base rules are not", () => {
    const edited = before + "\n@keyframes wobble { from { rotate: -2deg; } to { rotate: 2deg; } }\n.promo-banner { animation: wobble 2s infinite; }\n";
    const merged = carryOverCss(edited, after);
    expect(merged).toContain("@keyframes wobble");
    expect(merged).toContain(".promo-banner { animation: wobble 2s infinite; }");
    expect(merged.match(/@layer skin/g)).toHaveLength(1);
    expect(merged.match(/prefers-reduced-motion/g)).toHaveLength(1);
    // Restyling twice does not pile the kept rules up.
    const again = carryOverCss(merged, filesFor(choiceFor("soft")).css);
    expect(again.match(/@keyframes wobble/g)).toHaveLength(1);
    expect(again.match(/Added to this app; kept through the restyle/g)).toHaveLength(1);
  });
});

describe("restyling an app", () => {
  const existing = async () => {
    const app = fakeApp(freshApp());
    await applyDesignTo(app.target, choiceFor("workbench", { accent: "#7a8b5a" }));
    return app;
  };

  test("swaps the stylesheet, the design file, the fonts and the mode", async () => {
    const app = await existing();
    const md = app.files[DESIGN_PATH]!;
    const choice = restyledChoice(describeDesign(md), { style: "neon" }, readOf(md), "p");
    const result = await applyDesignTo(app.target, choice, { restyle: true });
    expect(result.applied).toBe(true);
    expect(describeDesign(app.files[DESIGN_PATH])).toMatchObject({ style: "neon", mode: "dark", accent: "#7a8b5a" });
    expect(app.files["src/index.css"]).toContain("the Neon style");
    expect(app.files["src/index.css"]).not.toContain("ibm-plex");
    expect(app.files["index.html"]).toContain('class="dark"');
    expect(app.installed.at(-1)).toContain("@fontsource-variable/oxanium");
    // What the app is has not changed, only how it looks.
    expect(readOf(app.files[DESIGN_PATH])).toBe(READ);
  });

  test("keeps what the app added to both files", async () => {
    const app = await existing();
    app.files["src/index.css"] = app.files["src/index.css"]!
      .replace(":root {\n", ":root {\n  --promo-from: #6d28d9;\n")
      .concat("\n.promo-banner { background: var(--promo-from); }\n");
    app.files[DESIGN_PATH] = app.files[DESIGN_PATH]!.replace(
      "## Do's and Don'ts\n",
      "## Do's and Don'ts\n- **Promo banner exception.** Purple, as the user asked.\n",
    );
    const md = app.files[DESIGN_PATH]!;
    await applyDesignTo(app.target, restyledChoice(describeDesign(md), { style: "craft" }, readOf(md), "p"), { restyle: true });
    expect(app.files["src/index.css"]).toContain("--promo-from: #6d28d9;");
    expect(app.files["src/index.css"]).toContain(".promo-banner { background: var(--promo-from); }");
    expect(app.files[DESIGN_PATH]).toContain("# Design — Craft");
    expect(app.files[DESIGN_PATH]).toContain("- **Promo banner exception.** Purple, as the user asked.");
  });

  test("a first design keeps nothing, because there is nothing of the app's to keep", async () => {
    const app = fakeApp({ ...freshApp(), "src/index.css": '@import "tailwindcss";\n.leftover { color: red; }\n' });
    await applyDesignTo(app.target, choiceFor("soft"));
    expect(app.files["src/index.css"]).not.toContain(".leftover");
  });
});

describe("the theme panel and the design file", () => {
  const md = filesFor(choiceFor("soft", { accent: "#7c6bf2" })).designMd;
  const tokens = { "--primary": "#0e7490", "--background": "#f0fafa", "--foreground": "#102a2e", "--card": "#ffffff", "--radius": "0.5rem" };
  const synced = syncDesignMd(md, tokens);

  test("a colour changed in the panel is the colour the design file states", () => {
    expect(synced).toContain("- The accent is `#0e7490` (`bg-primary`, `text-primary`). The page is `#f0fafa`, text is `#102a2e`.");
    const front = splitFrontMatter(synced).front!;
    expect(front).toContain('  primary: "#0e7490"');
    expect(front).toContain('  background: "#f0fafa"');
    expect(front).toContain('  on-background: "#102a2e"');
    expect(front).toContain('  surface: "#ffffff"');
    expect(front).toContain("rounded:\n  base: 0.5rem");
    expect(describeDesign(synced)!.accent).toBe("#0e7490");
  });

  test("the colour of text on a card follows the panel too", () => {
    const front = splitFrontMatter(syncDesignMd(md, { "--card": "#ffffff", "--card-foreground": "#1b2b34" })).front!;
    expect(front).toContain('  surface: "#ffffff"');
    expect(front).toContain('  on-surface: "#1b2b34"');
  });

  test("nothing else in the file moves", () => {
    const changed = synced.split("\n").filter((line, i) => line !== md.split("\n")[i]);
    expect(changed.length).toBeLessThanOrEqual(8);
    expect(synced.split("\n")).toHaveLength(md.split("\n").length);
    // A value the panel did not report is left as it was.
    expect(syncDesignMd(md, { "--primary": "#0e7490" })).toContain(`The page is \`${/The page is `(#[0-9a-f]{6})`/.exec(md)![1]}\``);
    expect(syncDesignMd(md, {})).toBe(md);
    expect(syncDesignMd(md, { "--primary": "oklch(0.5 0.1 200)" })).toBe(md);
  });

  test("a file tau did not write is left alone where it states nothing tau recognises", () => {
    const theirs = "# My design\n\nBlue buttons.\n";
    expect(syncDesignMd(theirs, tokens)).toBe(theirs);
  });

  test("a chosen pairing's fonts are not reported as off-design", () => {
    const deps = JSON.stringify({ dependencies: { "@fontsource-variable/playfair-display": "^5", "@fontsource-variable/karla": "^5", "@fontsource/pacifico": "^5" } });
    expect(checkPackageJson(deps, { style: STYLES.editorial }).map((f) => f.excerpt)).toEqual(["@fontsource/pacifico"]);
  });
});

describe("the director's rating of its own shortlist", () => {
  const reply = (extra: object) => JSON.stringify({ styles: ["editorial", "craft", "soft"], accents: ["#b5532a"], ...extra });

  test("a style it called a stretch is dropped; the first is always kept", () => {
    expect(parseDirectorReply(reply({ fits: [5, 4, 2] }))!.styles).toEqual(["editorial", "craft"]);
    expect(parseDirectorReply(reply({ fits: [5, 3, 3] }))!.styles).toEqual(["editorial"]);
    expect(parseDirectorReply(reply({ fits: [2, 2, 2] }))!.styles).toEqual(["editorial"]);
  });

  test("with no rating, or one that makes no sense, nothing is dropped", () => {
    expect(parseDirectorReply(reply({}))!.styles).toEqual(["editorial", "craft", "soft"]);
    expect(parseDirectorReply(reply({ fits: ["high", null, "x"] }))!.styles).toEqual(["editorial", "craft", "soft"]);
  });

  test("a rating stays with its style when an unknown one is skipped", () => {
    const r = JSON.stringify({ styles: ["editorial", "madeup", "soft"], fits: [5, 5, 2], accents: [] });
    expect(parseDirectorReply(r)!.styles).toEqual(["editorial"]);
  });

  test("the prompt asks for ratings and says a list of one is fine", () => {
    expect(directorPrompt("p")).toContain("a list of one is a good answer");
    expect(directorPrompt("p")).toContain('"fits": [5, 4, 4]');
  });
});

describe("the structure an app opens with", () => {
  const read = (what: string) => `Reading this as: ${what}, which should feel warm.`;

  test("is one of its style's own, and the same for the same app", () => {
    for (const style of ALL_STYLES) {
      const lead = leadLayout(style, read("a climbing gym"));
      expect(style.layouts.map((k) => LAYOUTS[k].name)).toContain(lead.name);
      expect(leadLayout(style, read("a climbing gym")).name).toBe(lead.name);
    }
  });

  test("differs between apps, so two in one style do not open alike", () => {
    const reads = ["a climbing gym", "a plumbing ledger", "a ska band", "a recipe journal", "a drone fleet", "a tea shop"].map(read);
    for (const style of ALL_STYLES) {
      expect(new Set(reads.map((r) => leadLayout(style, r).name)).size).toBeGreaterThanOrEqual(3);
    }
  });

  test("is said in the design file, and kept when the style is the same", () => {
    const md = filesFor(choiceFor("editorial")).designMd;
    expect(md).toContain(`This app opens with **${leadLayout(STYLES.editorial, READ).name}**`);
    expect(designProse(md)).toContain("open the screens after it a different way");
  });
});

// ── Phase 5: a light and dark switch, and where the greys lean ───────────────

describe("a light and dark switch in the app", () => {
  const HTML = '<!doctype html>\n<html lang="en">\n<head>\n  <title>App</title>\n</head>\n<body><div id="root"></div></body>\n</html>\n';
  const scriptOf = () => /<script>([\s\S]*)<\/script>/.exec(THEME_SWITCH_HTML)![1]!;

  test("goes into the head of index.html, once, and comes out again", () => {
    const on = themeSwitchHtml(HTML, true);
    expect(on).toContain("data-tau-theme-toggle");
    expect(on.indexOf("tau:theme-switch")).toBeLessThan(on.indexOf("</head>"));
    expect(themeSwitchHtml(on, true)).toBe(on);
    expect(themeSwitchHtml(on, false)).toBe(HTML);
    expect(themeSwitchHtml(HTML, false)).toBe(HTML);
    // A page with nowhere to put it is left alone.
    expect(themeSwitchHtml("<div></div>", true)).toBe("<div></div>");
  });

  test("is a script that parses, keeps the visitor's choice, and acts before the page paints", () => {
    const script = scriptOf();
    expect(() => new Function(script)).not.toThrow();
    expect(script.indexOf("localStorage.getItem")).toBeLessThan(script.indexOf("DOMContentLoaded"));
    expect(script).toContain('localStorage.setItem("tau-theme"');
  });

  test("runs in a page: the saved choice is applied, and the button flips and remembers it", () => {
    const store = new Map<string, string>([["tau-theme", "dark"]]);
    const listeners: Record<string, () => void> = {};
    const classes = new Set<string>();
    const clicks: (() => void)[] = [];
    const attrs: Record<string, string> = {};
    const button: Record<string, unknown> = {
      setAttribute: (k: string, v: string) => (attrs[k] = v),
      addEventListener: (_: string, fn: () => void) => clicks.push(fn),
    };
    const root = {
      classList: {
        add: (c: string) => classes.add(c),
        remove: (c: string) => classes.delete(c),
        contains: (c: string) => classes.has(c),
        toggle: (c: string, on: boolean) => (on ? classes.add(c) : classes.delete(c)),
      },
    };
    const doc = { documentElement: root, createElement: () => button, body: { appendChild: () => undefined } };
    new Function("document", "localStorage", "addEventListener", scriptOf())(
      doc,
      { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) },
      (name: string, fn: () => void) => (listeners[name] = fn),
    );
    expect(classes.has("dark")).toBe(true); // applied before DOMContentLoaded
    listeners.DOMContentLoaded!();
    expect(attrs["data-tau-theme-toggle"]).toBe("");
    expect(String(button.innerHTML)).toContain("<circle"); // dark: offers the sun
    clicks[0]!();
    expect(classes.has("dark")).toBe(false);
    expect(store.get("tau-theme")).toBe("light");
    expect(String(button.innerHTML)).toContain('<path d="M21 12.8');
  });

  test("is in the stylesheet, in the style's own controls, only when asked for; and the agent is told", () => {
    const off = filesFor(choiceFor("soft"));
    const on = filesFor(choiceFor("soft", { switch: true }));
    expect(off.css).not.toContain("data-tau-theme-toggle");
    expect(on.css).toContain("[data-tau-theme-toggle]");
    expect(on.css).toContain("border-radius: var(--control-radius)");
    expect(off.designMd).not.toContain("light and dark switch");
    expect(on.designMd).toContain("has its own light and dark switch");
    expect(readDesignMeta(on.designMd)!.switch).toBe("1");
    expect(describeDesign(on.designMd)!.switch).toBe(true);
    expect(describeDesign(off.designMd)!.switch).toBe(false);
  });

  test("is written to the app by apply, kept through a restyle, and taken out by one that says so", async () => {
    const app = fakeApp({ ...freshApp(), "index.html": HTML });
    await applyDesignTo(app.target, choiceFor("soft", { switch: true }));
    expect(app.files["index.html"]).toContain("data-tau-theme-toggle");
    const md = app.files[DESIGN_PATH]!;
    await applyDesignTo(app.target, restyledChoice(describeDesign(md), { style: "craft" }, readOf(md), "p"), { restyle: true });
    expect(app.files["index.html"]).toContain("data-tau-theme-toggle");
    expect(describeDesign(app.files[DESIGN_PATH])!.switch).toBe(true);
    const md2 = app.files[DESIGN_PATH]!;
    await applyDesignTo(app.target, restyledChoice(describeDesign(md2), { switch: false }, readOf(md2), "p"), { restyle: true });
    expect(app.files["index.html"]).not.toContain("data-tau-theme-toggle");
    expect(describeDesign(app.files[DESIGN_PATH])!.switch).toBe(false);
  });

  test("is the user's choice: the director cannot take it away, and it makes the choice theirs", () => {
    const choice = chooseFrom(offer(), "p1", { switch: true });
    expect(choice.switch).toBe(true);
    expect(choice.source).toBe("user");
    expect(fallbackChoice("p1", { switch: true }).switch).toBe(true);
    expect(chooseFrom(offer(), "p1", {}).switch).toBeUndefined();
  });
});

describe("where the greys lean", () => {
  const hue = (hex: string) => hexToOklch(hex).h;
  const chroma = (hex: string) => hexToOklch(hex).c;

  test("warm and cool move the neutrals, whatever the accent, and grey takes the tint away", () => {
    const base = buildTheme(STYLES.soft.palette, "#7c6bf2", STYLES.soft.radius);
    const warm = buildTheme(STYLES.soft.palette, "#7c6bf2", STYLES.soft.radius, { neutral: "warm" });
    const cool = buildTheme(STYLES.soft.palette, "#c2410c", STYLES.soft.radius, { neutral: "cool" });
    const grey = buildTheme(STYLES.soft.palette, "#7c6bf2", STYLES.soft.radius, { neutral: "grey" });
    expect(Math.abs(hue(warm.light.background) - 70)).toBeLessThan(8);
    expect(Math.abs(hue(cool.light.background) - 255)).toBeLessThan(8);
    expect(Math.abs(hue(base.light.background) - hue(warm.light.background))).toBeGreaterThan(20);
    expect(chroma(grey.light.background)).toBeLessThan(0.004);
    expect(chroma(grey.dark.muted)).toBeLessThan(0.004);
    // The accent itself is not touched by any of it.
    expect(grey.light.primary).toBe(base.light.primary);
    expect(warm.light.primary).toBe(base.light.primary);
  });

  test("text stays readable on every combination", () => {
    for (const style of ALL_STYLES) {
      for (const neutral of ["warm", "cool", "grey"] as const) {
        const theme = buildTheme(style.palette, "#2f7d6b", style.radius, { neutral });
        for (const mode of ["light", "dark"] as const) {
          expect(contrast(theme[mode].foreground, theme[mode].background)).toBeGreaterThanOrEqual(7);
          expect(contrast(theme[mode]["muted-foreground"], theme[mode].background)).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  test("is kept in the design file, read back, and carried through a change of style", () => {
    const files = filesFor(choiceFor("soft", { neutral: "warm" }));
    expect(readDesignMeta(files.designMd)!.neutral).toBe("warm");
    const summary = describeDesign(files.designMd)!;
    expect(summary.neutral).toBe("warm");
    expect(restyledChoice(summary, { style: "craft" }, READ, "p").neutral).toBe("warm");
    // Asked for anew, or given up in favour of the style's own.
    expect(restyledChoice(summary, { neutral: "cool" }, READ, "p").neutral).toBe("cool");
    expect(restyledChoice(summary, { neutral: "style" }, READ, "p").neutral).toBeUndefined();
    expect(describeDesign(filesFor(choiceFor("soft")).designMd)!.neutral).toBeNull();
  });

  test('a chosen lean is the user\'s; "style" is only for a restyle', () => {
    expect(normalizeDesignConfig({ neutral: "warm", switch: true })).toEqual({ neutral: "warm", switch: true });
    expect(normalizeDesignConfig({ neutral: "purple" })).toBeNull();
    expect(chooseFrom(offer(), "p1", { neutral: "cool" }).neutral).toBe("cool");
    expect(chooseFrom(offer(), "p1", { neutral: "style" }).neutral).toBeUndefined();
  });
});

describe("the three styles made of paper and print", () => {
  const NEW = ["scrapbook", "wabisabi", "victorian"] as const;

  test("are found by the names people know them by, and are not for general use", () => {
    expect(STYLES.scrapbook.aka).toContain("Collage");
    expect(STYLES.wabisabi.name).toBe("Wabi-sabi");
    expect(STYLES.wabisabi.aka).toContain("Wabi sabi");
    expect(STYLES.victorian.aka).toContain("Victorian era");
    for (const key of NEW) expect(STYLES[key].reach).toBe("niche");
  });

  test("paint their texture on the page, and the page wrapper lets it show", () => {
    for (const key of NEW) {
      const { css, designMd } = filesFor(choiceFor(key));
      expect(css).toContain("body::before");
      expect(css).toContain(".min-h-screen.bg-background");
      expect(designMd).toContain("The page has a backdrop");
    }
    // The grain is a picture drawn in the stylesheet: nothing is shipped with the app.
    expect(filesFor(choiceFor("scrapbook")).css).toContain("feTurbulence");
    expect(filesFor(choiceFor("scrapbook")).css).not.toMatch(/url\("(?!data:)/);
    expect(filesFor(choiceFor("wabisabi")).css).not.toMatch(/url\("(?!data:)/);
  });

  test("scrapbook cards are taped and crooked; wabi-sabi corners differ; victorian panels are ruled twice", () => {
    expect(filesFor(choiceFor("scrapbook")).css).toContain('[data-slot="card"]::before');
    expect(filesFor(choiceFor("scrapbook")).css).toContain("rotate(-0.5deg)");
    expect(STYLES.wabisabi.skin.cardRadius.split(" ")).toHaveLength(4);
    expect(new Set(STYLES.wabisabi.skin.cardRadius.split(" ")).size).toBeGreaterThan(2);
    expect(STYLES.victorian.skin.cardBorder).toContain("double");
    expect(STYLES.victorian.skin.cardRadius).toBe("0");
  });

  test("fonts are ones the image already holds", () => {
    const others = new Set(
      ALL_STYLES.filter((s) => !NEW.includes(s.key as (typeof NEW)[number])).flatMap((s) => fontSetsOf(s)).flatMap((f) => Object.values(f)).map((f) => f.pkg).filter(Boolean),
    );
    // Every package a new style names is one another style also names, so
    // nothing needs the sandbox image to be built again.
    for (const key of NEW) {
      for (const set of fontSetsOf(STYLES[key])) {
        for (const font of Object.values(set)) if (font.pkg) expect(others.has(font.pkg)).toBe(true);
      }
    }
  });
});
