import { describe, expect, test } from "bun:test";
import { mergedConfig } from "@/api/services/design.service";
import { designFiles, resolveDesign, withImportedShapes } from "@/worker/design";
import { normalizeDesignConfig, normalizeReference } from "@/worker/design/config";
import { chooseFrom, fallbackChoice, type DirectorOptions } from "@/worker/design/director";
import {
  CLOSEST_FACE,
  designMdFromReading,
  parseImageReading,
  readingPrompt,
  type ImageReading,
} from "@/worker/design/fromImage";
import { fontSlug, parseImportedDesign } from "@/worker/design/importDesign";
import { ownWords } from "@/worker/design/provision";
import { keptNotes } from "@/worker/design/restyle";
import { STYLES, allFontPackages } from "@/worker/design/styles";

// A screenshot the user wants their app to look like is read for values —
// colours, shapes, the kind of type — and written out as a DESIGN.md, which
// then goes through the same door as a design file brought by hand
// (doc/CONTEXT_AND_MEMORY_PLAN.md §10, part B). These cover the parts that
// need no model: reading the reply, writing the file, and what the file does.

const REPLY = {
  is_interface: true,
  wanted: true,
  mode: "dark",
  colors: {
    background: "#0B0F14",
    surface: "#131A22",
    text: "#E8EEF4",
    muted_text: "#8A97A6",
    primary: "#2DD4BF",
    on_primary: "#04201C",
    border: "#1F2A36",
  },
  control_corners: "pill",
  card_corners: "very-rounded",
  borders: "hairline",
  shadows: "soft",
  fields: "filled",
  uppercase_labels: false,
  density: 8,
  heading_type: "sans-geometric",
  body_type: "sans-neutral",
  summary: "A dark analytics dashboard with a teal accent. It feels calm and technical.",
  layout: ["A narrow sidebar on the left", "- Four figures across the top", "A wide chart beside a list"],
};

const reading = (over: Record<string, unknown> = {}): ImageReading =>
  parseImageReading(JSON.stringify({ ...REPLY, ...over }))!;

const offer = (over: Partial<DirectorOptions> = {}): DirectorOptions => ({
  styles: ["bento"],
  accents: ["#b5532a"],
  accentExact: false,
  mode: "light",
  dials: { variance: 5, motion: 5, density: 3 },
  read: "Reading this as: a dashboard for an operations team, which should feel calm and exact.",
  ...over,
});

describe("reading the model's reply", () => {
  test("takes the values as given, tidied", () => {
    const r = reading();
    expect(r.isInterface).toBe(true);
    expect(r.wanted).toBe(true);
    expect(r.mode).toBe("dark");
    expect(r.colors).toEqual({
      background: "#0b0f14",
      surface: "#131a22",
      text: "#e8eef4",
      mutedText: "#8a97a6",
      primary: "#2dd4bf",
      onPrimary: "#04201c",
      border: "#1f2a36",
    });
    expect(r.controlCorners).toBe("pill");
    expect(r.cardCorners).toBe("very-rounded");
    expect(r.density).toBe(8);
    expect(r.heading).toBe("sans-geometric");
    expect(r.layout).toEqual(["A narrow sidebar on the left", "Four figures across the top", "A wide chart beside a list"]);
  });

  test("finds the object in a reply with words around it", () => {
    expect(parseImageReading(`Here you go:\n\`\`\`json\n${JSON.stringify(REPLY)}\n\`\`\``)?.mode).toBe("dark");
  });

  test("is no reading at all without a page colour and an accent", () => {
    expect(parseImageReading("I cannot see the image.")).toBeNull();
    expect(parseImageReading("{not json}")).toBeNull();
    expect(parseImageReading(JSON.stringify({ ...REPLY, colors: { text: "#000000" } }))).toBeNull();
    expect(parseImageReading(JSON.stringify({ ...REPLY, colors: { ...REPLY.colors, primary: "teal" } }))).toBeNull();
  });

  test("a missing or unknown answer takes the plainest value", () => {
    const r = parseImageReading(
      JSON.stringify({ colors: { background: "#ffffff", primary: "#1d4ed8" }, control_corners: "blobby", density: 40, heading_type: "Serif Elegant" }),
    )!;
    expect(r.isInterface).toBe(true);
    // Nobody was asked what the user wanted, so nothing is assumed.
    expect(r.wanted).toBeNull();
    expect(r.controlCorners).toBe("rounded");
    expect(r.borders).toBe("hairline");
    expect(r.shadows).toBe("none");
    expect(r.density).toBe(10);
    expect(r.colors.surface).toBe("#ffffff");
    expect(r.colors.text).toBe("#141414");
    // Spelled loosely, still understood; and a heading face that cannot be
    // read as running text does not become the body face.
    expect(r.heading).toBe("serif-elegant");
    expect(r.body).toBe("sans-neutral");
  });

  test("light or dark is what the page colour says, whatever the reply claims", () => {
    expect(reading({ mode: "light" }).mode).toBe("dark");
    expect(reading({ mode: "dark", colors: { ...REPLY.colors, background: "#fafafa" } }).mode).toBe("light");
  });

  test("text on a button that could not be read on it is replaced", () => {
    expect(reading({ colors: { ...REPLY.colors, on_primary: "#34e0cb" } }).colors.onPrimary).not.toBe("#34e0cb");
    expect(reading({ colors: { ...REPLY.colors, on_primary: undefined } }).colors.onPrimary).toMatch(/^#[0-9a-f]{6}$/);
  });

  test("asks what the user wanted only when there is a message to judge by", () => {
    expect(readingPrompt(true)).toContain('"wanted"');
    expect(readingPrompt(false)).not.toContain('"wanted"');
    for (const kind of Object.keys(CLOSEST_FACE)) expect(readingPrompt(false)).toContain(`"${kind}"`);
    expect(readingPrompt(false)).toContain("Name no brand");
  });
});

describe("the typefaces a reading can name", () => {
  test("are all ones tau already installs, as variable fonts", () => {
    const installed = new Set(allFontPackages());
    for (const face of Object.values(CLOSEST_FACE)) {
      expect(installed.has(`@fontsource-variable/${fontSlug(face.family)}`)).toBe(true);
    }
  });
});

describe("a reading written out as a design file", () => {
  const md = designMdFromReading(reading());
  const imported = parseImportedDesign(md);

  test("is read back as the same colours, typefaces, shapes and density", () => {
    expect(imported.fromImage).toBe(true);
    expect(imported.tokens.colors).toEqual({
      primary: "#2dd4bf",
      "primary-foreground": "#04201c",
      background: "#0b0f14",
      foreground: "#e8eef4",
      card: "#131a22",
      "card-foreground": "#e8eef4",
      "muted-foreground": "#8a97a6",
      border: "#1f2a36",
    });
    expect(imported.tokens.fonts).toEqual({ display: "Outfit", body: "Instrument Sans" });
    expect(imported.tokens.radius).toBe("0.875rem");
    expect(imported.tokens.shapes).toEqual({
      control: "9999px",
      card: "1.25rem",
      borders: "hairline",
      shadows: "soft",
      fields: "filled",
      labels: "none",
    });
    expect(imported.tokens.density).toBe(8);
  });

  test("says what it is, that the typeface is a match, and what was not copied", () => {
    expect(md).toContain("# Design, read from a screenshot");
    expect(md).toContain("A dark analytics dashboard with a teal accent.");
    expect(md).toContain("**Outfit**, the closest match tau can install");
    expect(md).toContain("pill-shaped corners");
    expect(md).toContain("- A narrow sidebar on the left");
    expect(md).toContain("## Not copied");
    expect(md).toContain("logos, brand names and wording are not part of it");
  });

  test("a summary with quotes in it does not break the front matter", () => {
    const quoted = designMdFromReading(reading({ summary: 'A "serious" tool. Plain.' }));
    expect(parseImportedDesign(quoted).tokens.colors.primary).toBe("#2dd4bf");
    expect(quoted).toContain('description: "A \\"serious\\" tool. Plain."');
  });

  test("a picture that is not of an interface gives a palette and nothing else", () => {
    const photo = parseImportedDesign(designMdFromReading(reading({ is_interface: false })));
    expect(photo.fromImage).toBe(true);
    expect(photo.tokens.colors.primary).toBe("#2dd4bf");
    expect(photo.tokens.fonts).toEqual({});
    expect(photo.tokens.shapes).toBeUndefined();
    expect(photo.tokens.density).toBeUndefined();
    expect(photo.text).not.toContain("## Shapes");
  });

  test("a design file brought by hand is not taken for a screenshot", () => {
    expect(parseImportedDesign("---\ncolors:\n  primary: \"#0b5fff\"\n---\n# Mine").fromImage).toBeUndefined();
  });
});

describe("the shapes of an imported design", () => {
  const brutalist = STYLES.brutalist.skin;

  test("leave the style's skin alone where the design says nothing", () => {
    expect(withImportedShapes(brutalist, undefined)).toBe(brutalist);
    expect(withImportedShapes(brutalist, {})).toEqual(brutalist);
  });

  test("a pill button brings its badges and tabs with it, and leaves fields usable", () => {
    const skin = withImportedShapes(brutalist, { control: "9999px", card: "1.25rem" });
    expect(skin.controlRadius).toBe("9999px");
    expect(skin.badgeRadius).toBe("9999px");
    expect(skin.tabsRadius).toBe("9999px");
    expect(skin.fieldRadius).toBe("0.75rem");
    expect(skin.cardRadius).toBe("1.25rem");
    expect(skin.overlayRadius).toBe("1.25rem");
    expect(skin.checkRadius).not.toBe("0");
  });

  test("a square control squares everything that has to agree with it", () => {
    const skin = withImportedShapes(STYLES.soft.skin, { control: "0", card: "0" });
    expect(skin.controlRadius).toBe("0");
    expect(skin.fieldRadius).toBe("0");
    expect(skin.badgeRadius).toBe("0");
    expect(skin.checkRadius).toBe("0");
    expect(skin.cardRadius).toBe("0");
  });

  test("borders, shadows, fields and capitals are the design's", () => {
    const skin = withImportedShapes(brutalist, { borders: "none", shadows: "soft", fields: "underline", labels: "none" });
    expect(skin.cardBorder).toBe("0");
    expect(skin.borderWidth).toBe("1px");
    expect(skin.cardShadow).toContain("rgb(0 0 0");
    expect(skin.field).toBe("underline");
    expect(skin.buttonCase).toBe("none");
    expect(withImportedShapes(STYLES.soft.skin, { borders: "thick", shadows: "hard", labels: "uppercase" })).toMatchObject({
      borderWidth: "2px",
      cardShadow: "4px 4px 0 0 var(--foreground)",
      buttonCase: "uppercase",
      labelCase: "uppercase",
    });
  });

  test("a design file's own radius scale counts, however it spells square and pill", () => {
    const tokens = parseImportedDesign("---\nrounded:\n  md: 8px\n  button: 999px\n  card: 0px\n---\n# Mine").tokens;
    expect(tokens.radius).toBe("8px");
    expect(tokens.shapes).toEqual({ control: "9999px", card: "0" });
    // A file with no word on shapes has none.
    expect(parseImportedDesign("---\nrounded:\n  md: 8px\n---\n# Mine").tokens.shapes).toBeUndefined();
    expect(parseImportedDesign("---\nshapes:\n  borders: wobbly\ndensity: 12\n---\n# Mine").tokens).toEqual({ colors: {}, fonts: {} });
  });
});

describe("an app designed from a screenshot", () => {
  const imported = parseImportedDesign(designMdFromReading(reading()));
  const choice = chooseFrom(offer(), "p1", {}, imported);
  const files = designFiles(resolveDesign(choice), { fontsInstalled: true });

  test("is fitted to the closest style, and takes the picture's colours, mode and density", () => {
    expect(choice.style).toBe("bento");
    expect(choice.source).toBe("import");
    expect(choice.accent).toBe("#2dd4bf");
    expect(choice.accentExact).toBe(true);
    expect(choice.mode).toBe("dark");
    // The picture says how packed it is; that is not averaged with the style's.
    expect(choice.dials.density).toBe(8);
    expect(fallbackChoice("p1", {}, imported).dials.density).toBe(8);
    // Unless the user set the dial themselves.
    expect(chooseFrom(offer(), "p1", { dials: { density: 2 } }, imported).dials.density).toBe(2);
  });

  test("gets the picture's shapes in its stylesheet, over the style's own", () => {
    expect(files.css).toContain("--control-radius: 9999px;");
    expect(files.css).toContain("--card-radius: 1.25rem;");
    expect(files.css).toContain("--background: #0b0f14;");
    expect(files.css).toContain("--primary: #2dd4bf;");
    expect(STYLES.bento.skin.controlRadius).not.toBe("9999px");
  });

  test("has a design file that tells the agent what was and was not taken", () => {
    expect(files.designMd).toContain("## In this app");
    expect(files.designMd).toContain("# Design, read from a screenshot");
    expect(files.designMd).toContain("## Not copied");
    expect(files.designMd).toContain("## Notes for this app");
  });

  test("when the app is later given one of tau's styles, the screenshot's caveat goes with the screenshot", () => {
    const noted = `${files.designMd.trimEnd()}\n- The logo is always green.\n`;
    expect(keptNotes(noted)).toEqual(["- The logo is always green."]);
  });
});

describe("the picture a design came from", () => {
  const HASH = "a".repeat(64);
  const reference = { hash: HASH, mimeType: "image/png" };

  test("is kept as a hash and a type, and nothing else", () => {
    expect(normalizeReference({ hash: HASH.toUpperCase(), mimeType: "IMAGE/PNG", key: "tau/attachments/someone-else/x" })).toEqual(reference);
    expect(normalizeReference({ hash: "../../etc", mimeType: "image/png" })).toBeNull();
    expect(normalizeReference({ hash: HASH, mimeType: "text/html" })).toBeNull();
    expect(normalizeReference("nope")).toBeNull();
  });

  test("means nothing without the design that was read from it", () => {
    expect(normalizeDesignConfig({ designMd: "# D", reference })).toEqual({ designMd: "# D", reference });
    expect(normalizeDesignConfig({ style: "soft", reference })).toEqual({ style: "soft" });
    expect(normalizeDesignConfig({ reference })).toBeNull();
  });

  test("stays through a restyle that keeps the design, and goes when the design does", () => {
    const before = { designMd: "# D", reference };
    expect(mergedConfig(before, { accent: "#be123c" }, "bento", false)).toEqual({ ...before, accent: "#be123c" });
    // One of tau's styles replaces the imported design, and its picture with it.
    expect(mergedConfig(before, { style: "soft" }, "soft", true)).toEqual({ style: "soft" });
    // A file brought by hand replaces the one read from a picture.
    expect(mergedConfig(before, { designMd: "# Mine" }, "bento", false)).toEqual({ designMd: "# Mine" });
    // Another screenshot replaces both.
    const other = { hash: "b".repeat(64), mimeType: "image/jpeg" };
    expect(mergedConfig(before, { designMd: "# E", reference: other }, "bento", false)).toEqual({ designMd: "# E", reference: other });
  });
});

describe("what the user said, without what was attached", () => {
  test("is their own words only", () => {
    const message = `Build a CRM that looks like this.\n\n<attachment id="1" name="shot.png" kind="image">\nA page titled Plumbline with a brown button…\n</attachment>\n\n[Attached: shot.png]`;
    expect(ownWords(message)).toBe("Build a CRM that looks like this.");
    expect(ownWords("No attachment here.")).toBe("No attachment here.");
    expect(ownWords('<attachment id="1" name="a.png" kind="image">\nx\n</attachment>')).toBe("");
  });
});
