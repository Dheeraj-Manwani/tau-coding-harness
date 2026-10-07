import { describe, expect, test } from "bun:test";
import { applyThemeEdit, readThemeTokens } from "@/api/lib/themeEdit";
import { designConfigSchema } from "@/api/schemas/project.schema";
import { mergedConfig } from "@/api/services/design.service";
import { applyDesignTo, type DesignTarget } from "@/worker/design/apply";
import { SAMPLE_ACCENTS, designCatalog } from "@/worker/design/catalog";
import { checkPackageJson } from "@/worker/design/checks";
import { isHexColor } from "@/worker/design/color";
import {
  FEEL_PRESETS,
  MAX_IMPORTED_DESIGN_CHARS,
  describeDesign,
  normalizeDesignConfig,
} from "@/worker/design/config";
import {
  DESIGN_PATH,
  designProse,
  proseStamp,
  readDesignMeta,
  syncDesignMd,
} from "@/worker/design/designMd";
import {
  chooseFrom,
  fallbackChoice,
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
import { STYLE_KEYS, type DesignChoice, type StyleKey } from "@/worker/design/types";

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
  test("has twelve styles, each a different silhouette", () => {
    expect(STYLE_KEYS).toHaveLength(12);
    expect(ALL_STYLES.map((s) => s.key)).toEqual([...STYLE_KEYS]);
    const silhouettes = new Set(
      ALL_STYLES.map((s) =>
        [s.skin.controlRadius, s.skin.cardRadius, s.skin.buttonCase, s.skin.field, s.skin.tabs, s.skin.borderWidth, s.fonts.display.name].join("|"),
      ),
    );
    expect(silhouettes.size).toBe(12);
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
    for (const key of ["craft", "neon", "formal"] as const) {
      const { css, designMd } = filesFor(choiceFor(key));
      expect(css).toContain(`the ${STYLES[key].name} style`);
      expect(css).toContain("@layer skin");
      expect(designMd).toContain(`# Design — ${STYLES[key].name}`);
      expect(designProse(designMd).length).toBeLessThan(6_000);
      expect(describeDesign(designMd)?.style).toBe(key);
    }
    expect(STYLES.neon.defaultMode).toBe("dark");
  });
});

describe("the catalog someone chooses from", () => {
  const catalog = designCatalog();

  test("lists every style with what a picker needs and nothing it does not", () => {
    expect(catalog.styles.map((s) => s.key)).toEqual([...STYLE_KEYS]);
    for (const style of catalog.styles) {
      expect(Object.keys(style).sort()).toEqual(
        ["defaultMode", "dials", "fonts", "key", "look", "name", "sampleAccent", "suits", "swatch"].sort(),
      );
      expect(style.fonts[0]!.key).toBe(DEFAULT_FONTS);
      expect(style.fonts).toHaveLength(3);
      for (const colour of Object.values(style.swatch)) expect(isHexColor(colour)).toBe(true);
    }
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
  opts: { installsNow?: boolean; available?: (pkg: string) => boolean } = {},
) {
  const installed: string[][] = [];
  const target: DesignTarget = {
    installsNow: opts.installsNow ?? true,
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

  test("a file nobody has added to has nothing to keep", () => {
    expect(keptNotes(original)).toEqual([]);
    expect(keptNotes(null)).toEqual([]);
    expect(withKeptNotes(original, [])).toBe(original);
  });

  test("lines the agent or the user added are kept, wherever they were put", () => {
    const edited = original
      .replace("## Typography\n", "## Typography\n- **Pacifico** — `font-fun`. The promo banner's headline only.\n")
      .replace("## Do's and Don'ts\n", "## Do's and Don'ts\n- **Promo banner exception.** The home page banner uses purple to pink, as the user asked.\n")
      + "\n## Brand\nThe logo is always green.\n";
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

  test("they go at the end of the new file, and survive the restyle after that", () => {
    const notes = ["- **Promo banner exception.** Purple to pink."];
    const restyled = withKeptNotes(filesFor(choiceFor("brutalist")).designMd, notes);
    expect(restyled).toContain("## Kept from the previous design");
    expect(restyled.trimEnd().endsWith(notes[0]!)).toBe(true);
    expect(describeDesign(restyled)?.style).toBe("brutalist");
    // Restyle again: the notes are still notes, and the heading is not doubled.
    expect(keptNotes(restyled)).toEqual(notes);
    const again = withKeptNotes(filesFor(choiceFor("soft")).designMd, keptNotes(restyled));
    expect(again.match(/## Kept from the previous design/g)).toHaveLength(1);
  });

  test("if tau's wording has changed since the file was written, only whole foreign sections are kept", () => {
    // Stands in for a file written by an older tau: its prose is not what tau
    // would write for this design today, so it cannot be compared line by line.
    const older =
      original.replace("## Shapes\n", "## Shapes\nAn older sentence about corners.\n") +
      "\n## Brand\nThe logo is always green.\n";
    expect(readDesignMeta(older)!.base).not.toBe(proseStamp(older));
    const stale = older.replace(/ base=[0-9a-f]{8}/, " base=00000000");
    expect(keptNotes(stale)).toEqual(["## Brand", "The logo is always green."]);
  });

  test("an imported design keeps nothing of tau's, only sections tau never writes", () => {
    const imported = filesFor(chooseFrom(offer({ styles: ["swiss"] }), "p", {}, parseImportedDesign(THEIRS))).designMd;
    // Their file is one whole foreign document; its sections are theirs.
    expect(keptNotes(imported)).toContain("- Never use gradients.");
    expect(keptNotes(imported).join("\n")).not.toContain("In this app");
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
