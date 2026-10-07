import { describe, expect, test } from "bun:test";
import { applyThemeEdit, readThemeTokens } from "@/api/lib/themeEdit";
import { readDoc } from "@/worker/agent/docs";
import { renderAppBrief } from "@/worker/agent/context/appBrief";
import { setHtmlMode, tagButton } from "@/worker/design/apply";
import {
  contrast,
  ensureContrast,
  hexToOklch,
  isHexColor,
  oklchToHex,
  readableOn,
} from "@/worker/design/color";
import { buildDesignCss, fontImports, spacingUnit } from "@/worker/design/css";
import {
  DESIGN_PROSE_MAX_CHARS,
  describeDials,
  designProse,
  readDesignMeta,
  renderDesignMd,
} from "@/worker/design/designMd";
import {
  chooseFrom,
  directorPrompt,
  fallbackChoice,
  parseDirectorReply,
  pickRanked,
  shuffled,
  type DirectorOptions,
} from "@/worker/design/director";
import { designFiles, resolveDesign } from "@/worker/design";
import { LAYOUTS, LAYOUT_KEYS } from "@/worker/design/layouts";
import { buildTheme } from "@/worker/design/palette";
import { ALL_STYLES, GENERAL_STYLES, STYLES, allFontPackages } from "@/worker/design/styles";
import { STYLE_KEYS, type DesignChoice } from "@/worker/design/types";
import { THEME_COLOR_TOKENS } from "@/worker/templates/theme";

// Every new app is given a look of its own when it is created: a style from
// tau's library, tuned by an accent colour, a mode and three dials, written out
// as `src/index.css` (what the app runs on) and `.tau/DESIGN.md` (what the
// agent reads). These tests pin down what has to hold for *any* style and *any*
// accent, since neither is known in advance (doc/CONTEXT_AND_MEMORY_PLAN.md §5):
//   - the text can always be read;
//   - the stylesheet keeps the shape the theme panel edits;
//   - the written design stays small enough to send with every request.

/** A spread of accents: every part of the wheel, a near-grey, a very light and a very dark one. */
const ACCENTS = [
  "#dc2626", "#ea580c", "#facc15", "#a3e635", "#16a34a", "#0d9488",
  "#06b6d4", "#2563eb", "#7c3aed", "#db2777", "#8a8a8a", "#fef3c7", "#1c1917",
];

const choiceFor = (style: (typeof STYLE_KEYS)[number], over: Partial<DesignChoice> = {}): DesignChoice => ({
  style,
  accent: "#c2410c",
  accentExact: false,
  mode: STYLES[style].defaultMode,
  dials: STYLES[style].dials,
  read: "Reading this as: a neighbourhood bakery's ordering page for regulars, with a warm visual language, leaning handmade.",
  source: "director",
  ...over,
});

describe("colour", () => {
  test("hex survives a round trip through OKLCH", () => {
    for (const hex of ["#000000", "#ffffff", "#c2410c", "#22c55e", "#1e3a8a", "#facc15"]) {
      expect(oklchToHex(hexToOklch(hex))).toBe(hex);
    }
  });

  test("reads short and long hex, and rejects what is not hex", () => {
    expect(oklchToHex(hexToOklch("#fff"))).toBe("#ffffff");
    expect(oklchToHex(hexToOklch("#C2410CFF"))).toBe("#c2410c");
    expect(isHexColor("#abc")).toBe(true);
    expect(isHexColor("rebeccapurple")).toBe(false);
    expect(isHexColor("oklch(0.5 0.1 20)")).toBe(false);
    expect(isHexColor(42)).toBe(false);
  });

  test("contrast matches the WCAG reference values", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrast("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 1);
  });

  test("a colour sRGB cannot show is brought into range, not clipped to nonsense", () => {
    const hex = oklchToHex({ l: 0.7, c: 0.4, h: 145 });
    expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    const back = hexToOklch(hex);
    expect(back.l).toBeCloseTo(0.7, 1);
    expect(Math.abs(back.h - 145)).toBeLessThan(6);
  });

  test("ensureContrast changes lightness only, and only as far as needed", () => {
    const grey = { l: 0.7, c: 0.02, h: 80 };
    const fixed = ensureContrast(grey, "#ffffff", 4.5);
    expect(contrast(oklchToHex(fixed), "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(fixed.c).toBe(grey.c);
    expect(fixed.h).toBe(grey.h);
    const fine = { l: 0.2, c: 0.02, h: 80 };
    expect(ensureContrast(fine, "#ffffff", 4.5)).toBe(fine);
  });

  test("readableOn picks light text for dark fills and dark text for light ones", () => {
    expect(hexToOklch(readableOn("#1e3a8a")).l).toBeGreaterThan(0.9);
    expect(hexToOklch(readableOn("#fde047")).l).toBeLessThan(0.3);
  });
});

describe("every style, with every accent, in both modes", () => {
  for (const style of ALL_STYLES) {
    test(`${style.key}: text can be read`, () => {
      for (const accent of ACCENTS) {
        const theme = buildTheme(style.palette, accent, style.radius);
        for (const p of [theme.light, theme.dark]) {
          for (const name of THEME_COLOR_TOKENS) expect(p[name]).toMatch(/^#[0-9a-f]{6}$/);

          expect(contrast(p.foreground, p.background)).toBeGreaterThanOrEqual(7);
          expect(contrast(p["card-foreground"], p.card)).toBeGreaterThanOrEqual(7);
          expect(contrast(p["secondary-foreground"], p.secondary)).toBeGreaterThanOrEqual(7);
          expect(contrast(p["accent-foreground"], p.accent)).toBeGreaterThanOrEqual(7);
          expect(contrast(p["muted-foreground"], p.background)).toBeGreaterThanOrEqual(4.5);
          expect(contrast(p["muted-foreground"], p.muted)).toBeGreaterThanOrEqual(4.5);
          expect(contrast(p["primary-foreground"], p.primary)).toBeGreaterThanOrEqual(4.5);
          expect(contrast(p.destructive, p.background)).toBeGreaterThanOrEqual(4.5);
          // A filled control can be told from the page — unless the style
          // outlines its fills, in which case the outline does that job.
          if (!style.palette.fencedPrimary) {
            expect(contrast(p.primary, p.background)).toBeGreaterThanOrEqual(3);
          }
        }
      }
    });
  }

  test("the accent decides the hue; the style decides everything else", () => {
    for (const style of ALL_STYLES) {
      const red = buildTheme(style.palette, "#dc2626", style.radius);
      const teal = buildTheme(style.palette, "#0d9488", style.radius);
      expect(red.light.primary).not.toBe(teal.light.primary);
      expect(Math.abs(hexToOklch(red.light.primary).h - hexToOklch("#dc2626").h)).toBeLessThan(12);
      expect(Math.abs(hexToOklch(teal.light.primary).h - hexToOklch("#0d9488").h)).toBeLessThan(12);
      // Same structure: the page is as light in one as in the other.
      expect(hexToOklch(red.light.background).l).toBeCloseTo(hexToOklch(teal.light.background).l, 1);
    }
  });

  test("two styles given the same accent do not produce the same palette", () => {
    const palettes = ALL_STYLES.map((s) => JSON.stringify(buildTheme(s.palette, "#c2410c", s.radius)));
    expect(new Set(palettes).size).toBe(ALL_STYLES.length);
  });

  test("an exact accent is used as given in the mode the app opens in", () => {
    const style = STYLES.swiss;
    const brand = "#1db954";
    const exact = buildTheme(style.palette, brand, style.radius, { exact: true, mode: "dark" });
    expect(exact.dark.primary).toBe(brand);
    // The other mode still gets the style's own rendering of the hue.
    expect(exact.light.primary).not.toBe(brand);
    expect(contrast(exact.dark["primary-foreground"], exact.dark.primary)).toBeGreaterThanOrEqual(4.5);
  });

  test("an exact accent the page would swallow is still made visible", () => {
    const style = STYLES.swiss;
    const theme = buildTheme(style.palette, "#fefce8", style.radius, { exact: true, mode: "light" });
    expect(contrast(theme.light.primary, theme.light.background)).toBeGreaterThanOrEqual(3);
  });

  test("a bright accent stays bright where the style outlines its fills", () => {
    const yellow = buildTheme(STYLES.brutalist.palette, "#facc15", STYLES.brutalist.radius);
    expect(hexToOklch(yellow.light.primary).l).toBeGreaterThan(0.82);
    // …and is darkened where nothing would fence it off from a white page.
    const plain = buildTheme(STYLES.swiss.palette, "#facc15", STYLES.swiss.radius);
    expect(hexToOklch(plain.light.primary).l).toBeLessThan(0.75);
  });
});

describe("the style library", () => {
  test("every key has a style, and every style is complete", () => {
    expect(ALL_STYLES.map((s) => s.key)).toEqual([...STYLE_KEYS]);
    for (const s of ALL_STYLES) {
      expect(s.look.length).toBeGreaterThan(40);
      expect(s.suits.length).toBeGreaterThan(40);
      for (const dial of Object.values(s.dials)) {
        expect(dial).toBeGreaterThanOrEqual(1);
        expect(dial).toBeLessThanOrEqual(10);
      }
      for (const value of Object.values(s.skin)) expect(String(value).length).toBeGreaterThan(0);
      expect(s.prose.dos.length).toBeGreaterThanOrEqual(3);
      expect(s.prose.donts.length).toBeGreaterThanOrEqual(3);
    }
  });

  test("every style can structure both a page and an app", () => {
    for (const s of ALL_STYLES) {
      for (const key of s.layouts) expect(LAYOUT_KEYS as readonly string[]).toContain(key);
      expect(new Set(s.layouts).size).toBe(s.layouts.length);
      expect(s.layouts.some((k) => LAYOUTS[k].kind === "page")).toBe(true);
      expect(s.layouts.some((k) => LAYOUTS[k].kind === "app")).toBe(true);
    }
  });

  test("every layout is allowed by some style, and explained in the guide", () => {
    const guide = readDoc("layouts");
    for (const key of LAYOUT_KEYS) {
      expect(ALL_STYLES.some((s) => s.layouts.includes(key))).toBe(true);
      expect(guide).toContain(`**${LAYOUTS[key].name}**`);
    }
  });

  test("fonts come from Fontsource packages, with files to import", () => {
    for (const pkg of allFontPackages()) {
      expect(pkg).toMatch(/^@fontsource(-variable)?\/[a-z0-9-]+$/);
    }
    for (const s of ALL_STYLES) {
      for (const font of Object.values(s.fonts)) {
        if (!font.pkg) continue;
        expect(font.imports!.length).toBeGreaterThan(0);
        for (const spec of font.imports!) expect(spec.startsWith(font.pkg)).toBe(true);
      }
    }
  });

  test("no style reaches for the typefaces everything else uses", () => {
    for (const s of ALL_STYLES) {
      for (const font of [s.fonts.display, s.fonts.body]) {
        expect(["Inter", "Roboto", "Arial", "Open Sans", "Geist"]).not.toContain(font.name);
      }
    }
  });

  test("the looks are told apart by more than colour", () => {
    // Shape, casing, field and tab treatment: at least this many distinct
    // combinations, or two styles are the same silhouette in different paint.
    const silhouettes = ALL_STYLES.map((s) =>
      [s.skin.controlRadius, s.skin.cardRadius, s.skin.buttonCase, s.skin.field, s.skin.tabs, s.skin.borderWidth, s.fonts.display.name].join("|"),
    );
    expect(new Set(silhouettes).size).toBe(ALL_STYLES.length);
  });
});

describe("the stylesheet", () => {
  const SLOTS = new Set([
    "button", "input", "textarea", "select-trigger", "select-content", "card", "card-header",
    "card-title", "card-content", "card-footer", "badge", "tabs", "tabs-list", "tabs-trigger",
    "dialog-content", "dialog-overlay", "dialog-title", "alert-dialog-content", "alert-dialog-overlay",
    "alert-dialog-title", "popover-content", "dropdown-menu-content", "sheet-content", "sheet-overlay",
    "sheet-title", "label", "table-head", "table-cell", "table-row", "checkbox", "switch",
    "switch-thumb", "avatar", "avatar-image", "avatar-fallback", "separator",
  ]);

  for (const style of ALL_STYLES) {
    test(`${style.key}: is well-formed and keeps the shape the theme panel edits`, () => {
      const design = resolveDesign(choiceFor(style.key));
      const { css } = designFiles(design, { fontsInstalled: true });

      // Balanced, so one style's skin cannot swallow the rules after it.
      expect(css.split("{").length).toBe(css.split("}").length);
      expect(css.endsWith("}\n")).toBe(true);

      // The panel finds every token it offers, in both palettes, as written.
      const tokens = readThemeTokens(css);
      expect(tokens.root["--primary"]).toBe(design.theme.light.primary);
      expect(tokens.dark["--primary"]).toBe(design.theme.dark.primary);
      expect(tokens.root["--background"]).toBe(design.theme.light.background);
      expect(tokens.dark["--muted-foreground"]).toBe(design.theme.dark["muted-foreground"]);
      expect(tokens.root["--radius"]).toBe(style.radius);

      // …and can change one without disturbing anything else.
      const edited = applyThemeEdit({ content: css, name: "--primary", value: "#123456", scope: "dark" });
      expect(edited.ok).toBe(true);
      if (edited.ok) {
        expect(readThemeTokens(edited.content).dark["--primary"]).toBe("#123456");
        expect(readThemeTokens(edited.content).root["--primary"]).toBe(design.theme.light.primary);
        expect(edited.content.length).toBe(css.length);
      }

      // The skin only addresses components that exist.
      for (const m of css.matchAll(/\[data-slot="([a-z-]+)"\]/g)) expect(SLOTS.has(m[1]!)).toBe(true);
      expect(css).toContain("@layer skin {");
      expect(css.indexOf("@layer skin")).toBeGreaterThan(css.indexOf('@import "tailwindcss"'));
      expect(css).toContain('@import "shadcn/tailwind.css";');
      expect(css).toContain("prefers-reduced-motion: reduce");
      expect(css).toContain(`--font-heading: ${style.fonts.display.stack};`);
    });
  }

  test("imports the style's fonts when they are installed, and none when they are not", () => {
    const design = resolveDesign(choiceFor("editorial"));
    const withFonts = designFiles(design, { fontsInstalled: true }).css;
    for (const spec of fontImports(STYLES.editorial.fonts)) {
      expect(withFonts).toContain(`@import "${spec}";`);
    }
    const without = designFiles(design, { fontsInstalled: false }).css;
    expect(without).not.toContain("@fontsource");
    // The stacks still name the font and fall back to a system one.
    expect(without).toContain("ui-serif");
  });

  test("a font used for two roles is imported once", () => {
    const imports = fontImports(STYLES.terminal.fonts);
    expect(imports).toEqual(["@fontsource-variable/jetbrains-mono"]);
  });

  test("density moves the spacing unit, within a sane range", () => {
    const units = [1, 3, 5, 8, 10].map((d) => parseFloat(spacingUnit(d)));
    for (let i = 1; i < units.length; i++) expect(units[i]!).toBeLessThan(units[i - 1]!);
    expect(units[0]!).toBeLessThanOrEqual(0.29);
    expect(units.at(-1)!).toBeGreaterThanOrEqual(0.21);
    expect(spacingUnit(99)).toBe(spacingUnit(10));
    expect(spacingUnit(-4)).toBe(spacingUnit(1));
  });

  test("says which mode the app opens in", () => {
    const base = { style: STYLES.swiss, theme: resolveDesign(choiceFor("swiss")).theme, dials: STYLES.swiss.dials, fontsInstalled: true };
    expect(buildDesignCss({ ...base, mode: "dark" })).toContain("The app opens dark");
    expect(buildDesignCss({ ...base, mode: "light" })).toContain("The app opens light");
  });

  test("is the same file for the same design", () => {
    const a = designFiles(resolveDesign(choiceFor("bento")), { fontsInstalled: true });
    const b = designFiles(resolveDesign(choiceFor("bento")), { fontsInstalled: true });
    expect(a.css).toBe(b.css);
    expect(a.designMd).toBe(b.designMd);
  });
});

describe("DESIGN.md", () => {
  const SECTIONS = [
    "## Overview", "## Colors", "## Typography", "## Layout",
    "## Elevation & Depth", "## Shapes", "## Components", "## Do's and Don'ts",
  ];

  for (const style of ALL_STYLES) {
    test(`${style.key}: follows the format, in order, and fits in a request`, () => {
      const choice = choiceFor(style.key);
      const { theme } = resolveDesign(choice);
      const md = renderDesignMd(style, choice, theme);

      // Front matter: opens the file, is closed, carries the tokens.
      expect(md.startsWith("---\nversion: alpha\n")).toBe(true);
      const close = md.indexOf("\n---\n", 4);
      expect(close).toBeGreaterThan(0);
      const front = md.slice(0, close);
      for (const key of ["name:", "description:", "colors:", "typography:", "rounded:", "spacing:", "components:"]) {
        expect(front).toContain(`\n${key}`);
      }
      const p = choice.mode === "dark" ? theme.dark : theme.light;
      expect(front).toContain(`primary: "${p.primary}"`);

      // Sections present once each, in the order the format requires.
      let at = 0;
      for (const heading of SECTIONS) {
        const next = md.indexOf(`\n${heading}\n`, at);
        expect(next).toBeGreaterThan(at);
        at = next;
      }

      // What the agent is sent: prose only, and small.
      const prose = designProse(md);
      expect(prose.startsWith(`# Design — ${style.name}`)).toBe(true);
      expect(prose).not.toContain("version: alpha");
      expect(prose).not.toContain("<!-- tau:");
      expect(prose).toContain(choice.read);
      expect(prose.length).toBeLessThan(DESIGN_PROSE_MAX_CHARS);
      for (const key of style.layouts) expect(prose).toContain(`**${LAYOUTS[key].name}**`);
      expect(prose).toContain(style.fonts.display.name);
    });
  }

  test("records how the design was chosen, readably", () => {
    const choice = choiceFor("luxe", { accent: "#c8a45c", mode: "dark", dials: { variance: 7, motion: 5, density: 2 } });
    const md = renderDesignMd(STYLES.luxe, choice, resolveDesign(choice).theme);
    expect(readDesignMeta(md)).toEqual({
      style: "luxe", mode: "dark", accent: "#c8a45c", variance: "7", motion: "5", density: "2",
    });
    expect(readDesignMeta("# A design someone else wrote")).toBeNull();
  });

  test("the dials are spelled out as instructions", () => {
    const [variance, motion, density] = describeDials({ variance: 2, motion: 8, density: 5 });
    expect(variance).toContain("symmetric");
    expect(motion).toContain("lively");
    expect(density).toContain("balanced");
  });

  test("a description with quotes in it does not break the front matter", () => {
    const choice = choiceFor("swiss", { read: 'Reading this as: a "serious" tool for accountants\\auditors, with a plain language.' });
    const md = renderDesignMd(STYLES.swiss, choice, resolveDesign(choice).theme);
    expect(md).toContain('description: "Reading this as: a \\"serious\\" tool for accountants\\\\auditors, with a plain language."');
  });

  test("prose is taken from a file tau did not write, too", () => {
    const foreign = "---\nname: Imported\ncolors:\n  primary: \"#ff0000\"\n---\n\n# Overview\nBold and red.\n";
    expect(designProse(foreign)).toBe("# Overview\nBold and red.");
    expect(designProse("# No front matter\nJust prose.")).toBe("# No front matter\nJust prose.");
  });

  test("an overlong design is cut, and says so", () => {
    const long = `# Design\n${"words ".repeat(3_000)}`;
    const prose = designProse(long);
    expect(prose.length).toBeLessThan(DESIGN_PROSE_MAX_CHARS + 200);
    expect(prose).toContain("is cut here");
  });

  test("reaches the agent in the app block, after the memory", () => {
    const choice = choiceFor("soft");
    const md = renderDesignMd(STYLES.soft, choice, resolveDesign(choice).theme);
    const brief = renderAppBrief(
      { memory: "# App memory\n", design: md, files: [{ path: "src/App.tsx", sizeBytes: 500 }] },
      "request",
    );
    expect(brief).toContain('<design file=".tau/DESIGN.md">\n# Design — Soft');
    expect(brief.indexOf("<memory")).toBeLessThan(brief.indexOf("<design"));
    expect(brief.indexOf("<design")).toBeLessThan(brief.indexOf("<files>"));
    expect(brief).not.toContain("version: alpha");

    const none = renderAppBrief({ memory: "# App memory\n", files: [] }, "request");
    expect(none).not.toContain("<design");
  });
});

describe("the design director", () => {
  const offer = (over: Partial<DirectorOptions> = {}): DirectorOptions => ({
    styles: ["bento", "swiss", "workbench"],
    accents: ["#0f766e", "#be123c", "#a16207"],
    accentExact: false,
    mode: "light",
    dials: { variance: 5, motion: 5, density: 5 },
    read: "Reading this as: a metrics dashboard for a founder, which should feel clear and calm.",
    ...over,
  });

  test("lists every style with what it is not for, in an order that depends on the project", () => {
    const a = directorPrompt("project-a");
    const b = directorPrompt("project-b");
    for (const s of ALL_STYLES) {
      expect(s.avoid.startsWith("Not for ")).toBe(true);
      expect(a).toContain(`- ${s.key}: ${s.look} Suits: ${s.suits} ${s.avoid}`);
      expect(b).toContain(`- ${s.key}: `);
    }
    expect(a).not.toBe(b);
    expect(directorPrompt("project-a")).toBe(a);
  });

  test("the shuffle is a permutation, and no style is always first", () => {
    const firsts = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const order = shuffled(STYLE_KEYS, `seed-${i}`);
      expect([...order].sort()).toEqual([...STYLE_KEYS].sort());
      firsts.add(order[0]!);
    }
    expect(firsts.size).toBe(STYLE_KEYS.length);
  });

  test("reads a well-formed reply as shortlists", () => {
    const options = parseDirectorReply(
      JSON.stringify({
        styles: ["editorial", "Soft", "luxe"],
        accents: ["#B4551F", "#4d7c0f", "#0e7490"],
        accent_exact: false, mode: "light", variance: 6, motion: 3, density: 2,
        read: "Reading this as: a coffee roaster's site for local customers, which should feel warm and unhurried.",
      }),
    );
    expect(options).toEqual({
      styles: ["editorial", "soft", "luxe"],
      accents: ["#b4551f", "#4d7c0f", "#0e7490"],
      accentExact: false,
      mode: "light",
      dials: { variance: 6, motion: 3, density: 2 },
      read: "Reading this as: a coffee roaster's site for local customers, which should feel warm and unhurried.",
    });
  });

  test("tolerates wrapping text, the single-valued form, string numbers and out-of-range dials", () => {
    const options = parseDirectorReply(
      'Here you go:\n```json\n{"style":"Terminal","accent":"#22c55e","mode":"dark","variance":"14","motion":0,"density":7.6,"read":"short"}\n```',
    )!;
    expect(options.styles).toEqual(["terminal"]);
    expect(options.accents).toEqual(["#22c55e"]);
    expect(options.dials).toEqual({ variance: 10, motion: 1, density: 8 });
    // Too short to be a real read.
    expect(options.read).toBeNull();
  });

  test("drops what it cannot use, and never invents a style", () => {
    const options = parseDirectorReply(
      '{"styles":["vaporwave","luxe","luxe","soft"],"accents":["sage green","#c8a45c",42]}',
    )!;
    expect(options.styles).toEqual(["luxe", "soft"]);
    expect(options.accents).toEqual(["#c8a45c"]);
    expect(options.mode).toBeNull();
    expect(options.dials).toEqual({ variance: null, motion: null, density: null });

    expect(parseDirectorReply('{"styles":["vaporwave"],"accents":["#ff00ff"]}')).toBeNull();
    expect(parseDirectorReply("no json here")).toBeNull();
    expect(parseDirectorReply('{"styles": ')).toBeNull();
  });

  test("three shades of one colour are one option, not three", () => {
    const options = parseDirectorReply(
      '{"styles":["editorial"],"accents":["#b4551f","#c05621","#b45309","#0f766e"]}',
    )!;
    expect(options.accents).toEqual(["#b4551f", "#0f766e"]);
  });

  test("a colour that is not hex cannot be marked exact", () => {
    const options = parseDirectorReply('{"styles":["soft"],"accents":["sage green"],"accent_exact":true}')!;
    expect(options.accents).toEqual([]);
    expect(options.accentExact).toBe(false);
    expect(isHexColor(chooseFrom(options, "seed").accent)).toBe(true);
  });

  test("picks from the shortlist: always something offered, mostly the first, not only the first", () => {
    const styles = new Map<string, number>();
    const accents = new Map<string, number>();
    const N = 600;
    for (let i = 0; i < N; i++) {
      const choice = chooseFrom(offer(), `project-${i}`);
      styles.set(choice.style, (styles.get(choice.style) ?? 0) + 1);
      accents.set(choice.accent, (accents.get(choice.accent) ?? 0) + 1);
    }
    expect([...styles.keys()].sort()).toEqual(["bento", "swiss", "workbench"]);
    expect([...accents.keys()].sort()).toEqual(["#0f766e", "#a16207", "#be123c"]);
    // Weighted toward the top of the list, with real room for the rest.
    expect(styles.get("bento")! / N).toBeGreaterThan(0.4);
    expect(styles.get("bento")! / N).toBeLessThan(0.6);
    expect(styles.get("workbench")! / N).toBeGreaterThan(0.12);
    expect(accents.get("#0f766e")! / N).toBeLessThan(0.5);
    expect(accents.get("#a16207")! / N).toBeGreaterThan(0.17);
  });

  test("the same project always gets the same pick", () => {
    expect(chooseFrom(offer(), "p1")).toEqual(chooseFrom(offer(), "p1"));
  });

  test("a shortlist of one is a decision; an exact colour is never swapped for another", () => {
    for (let i = 0; i < 40; i++) {
      expect(chooseFrom(offer({ styles: ["brutalist"] }), `p${i}`).style).toBe("brutalist");
      const exact = chooseFrom(offer({ accentExact: true }), `p${i}`);
      expect(exact.accent).toBe("#0f766e");
      expect(exact.accentExact).toBe(true);
    }
  });

  test("the dials meet the chosen style half way", () => {
    // A dashboard's density, landing in a style built to be airy.
    const choice = chooseFrom(offer({ styles: ["editorial"], dials: { variance: 3, motion: 2, density: 9 } }), "p");
    const own = STYLES.editorial.dials;
    expect(choice.dials).toEqual({
      variance: Math.round((3 + own.variance) / 2),
      motion: Math.round((2 + own.motion) / 2),
      density: Math.round((9 + own.density) / 2),
    });
    // Nothing asked for: the style's own.
    const bare = chooseFrom(offer({ styles: ["luxe"], dials: { variance: null, motion: null, density: null }, mode: null, read: null }), "p");
    expect(bare.dials).toEqual(STYLES.luxe.dials);
    expect(bare.mode).toBe(STYLES.luxe.defaultMode);
    expect(bare.read.startsWith("Reading this as:")).toBe(true);
  });

  test("pickRanked shares out the weight of missing places", () => {
    const counts = [0, 0];
    for (let i = 0; i < 500; i++) counts[pickRanked([0, 1], [0.5, 0.3, 0.2], `s${i}`)]!++;
    // 0.5 : 0.3 → 62.5% : 37.5%
    expect(counts[0]! / 500).toBeGreaterThan(0.54);
    expect(counts[0]! / 500).toBeLessThan(0.71);
    expect(() => pickRanked([], [1], "s")).toThrow();
  });

  test("the fallback is fixed per project and varies across projects", () => {
    expect(fallbackChoice("p1")).toEqual(fallbackChoice("p1"));
    const styles = new Set<string>();
    const accents = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const c = fallbackChoice(`project-${i}`);
      expect(c.source).toBe("fallback");
      styles.add(c.style);
      accents.add(c.accent);
    }
    expect(styles.size).toBe(GENERAL_STYLES.length);
    expect(accents.size).toBeGreaterThan(5);
  });

  test("the fallback never picks a look that a brief has to call for", () => {
    // Enough general styles that apps still differ when the director is down.
    expect(GENERAL_STYLES.length).toBeGreaterThanOrEqual(6);
    for (let i = 0; i < 400; i++) {
      expect(STYLES[fallbackChoice(`project-${i}`).style].reach).toBe("general");
    }
    // A style the user chose is theirs, whatever its reach.
    expect(fallbackChoice("p1", { style: "pixel" }).style).toBe("pixel");
  });
});

describe("applying a design to the scaffold", () => {
  const STOCK_BUTTON = `function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}`;

  test("the stock button is given the attributes the skin keys on", () => {
    const tagged = tagButton(STOCK_BUTTON)!;
    expect(tagged).toContain(
      '      data-slot="button"\n      data-variant={variant}\n      data-size={size}\n      className=',
    );
    // Applying it again changes nothing.
    expect(tagButton(tagged)).toBe(tagged);
  });

  test("a button file it does not recognise is left alone", () => {
    expect(tagButton("export const Button = (p) => <button {...p} />")).toBeNull();
  });

  test("sets the mode on <html> and keeps whatever else is there", () => {
    const dark = '<!doctype html>\n<html lang="en" class="dark">\n<head></head></html>';
    const light = '<!doctype html>\n<html lang="en">\n<head></head></html>';
    expect(setHtmlMode(dark, "light")).toBe(light);
    expect(setHtmlMode(light, "dark")).toBe(dark);
    expect(setHtmlMode(dark, "dark")).toBe(dark);
    expect(setHtmlMode(light, "light")).toBe(light);
    expect(setHtmlMode('<html lang="en" class="h-full dark">', "light")).toBe('<html lang="en" class="h-full">');
    expect(setHtmlMode('<html class="h-full" lang="en">', "dark")).toBe('<html lang="en" class="h-full dark">');
  });
});
