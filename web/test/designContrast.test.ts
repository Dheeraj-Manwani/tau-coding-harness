import { describe, expect, test } from "bun:test";

import type { CatalogStyle, DesignSummary } from "../src/features/design/api";
import {
  ACCENT_CONTRAST,
  accentWarning,
  contrast,
  readableAccent,
} from "../src/features/design/contrast";

// An accent the user picks is used exactly as picked, so a colour that will be
// hard to see is something to tell them about while they are choosing — and
// only when it can be known what page it will sit on.

const style = (over: Partial<CatalogStyle> & { key: string }): CatalogStyle => ({
  name: over.key,
  aka: [],
  group: "precise",
  look: "",
  suits: "",
  defaultMode: "light",
  dials: { variance: 5, motion: 5, density: 5 },
  fonts: [{ key: "default", label: "A" }],
  swatch: { background: "#fff", card: "#fff", foreground: "#000", primary: "#f00", border: "#ccc" },
  page: { light: "#faf9f6", dark: "#101014" },
  sampleAccent: "#f00",
  ...over,
});

const styles = [
  style({ key: "soft" }),
  style({ key: "neon", defaultMode: "dark" }),
  style({ key: "brutalist", outlined: true }),
];

const app = (over: Partial<DesignSummary> = {}): DesignSummary => ({
  style: "soft",
  styleName: "Soft",
  accent: "#1d4ed8",
  mode: "light",
  dials: { variance: 5, motion: 5, density: 5 },
  fonts: "default",
  fontsLabel: "A",
  imported: false,
  ...over,
});

const NAVY = "#14213d";
const LEMON = "#fff275";

describe("contrast", () => {
  test("is WCAG's ratio, whichever way round", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#777777")).toBe(1);
    expect(contrast("#767676", "#ffffff")).toBeGreaterThan(4.5);
    // Not a colour: nothing to say about it.
    expect(contrast("blue", "#ffffff")).toBe(1);
  });
});

describe("the nearest shade that shows", () => {
  test("a colour that already shows is left alone", () => {
    expect(readableAccent("#1D4ED8", "#ffffff")).toBe("#1d4ed8");
  });

  test("a dark colour on a dark page is lightened only as far as it takes", () => {
    const fixed = readableAccent(NAVY, "#101014");
    expect(contrast(fixed, "#101014")).toBeGreaterThanOrEqual(ACCENT_CONTRAST);
    expect(contrast(fixed, "#101014")).toBeLessThan(ACCENT_CONTRAST + 0.2);
    // Still a blue: blue is its strongest channel, as it was.
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(fixed.slice(i, i + 2), 16));
    expect(b!).toBeGreaterThan(r!);
    expect(b!).toBeGreaterThan(g!);
  });

  test("a pale colour on a light page is darkened", () => {
    const fixed = readableAccent(LEMON, "#faf9f6");
    expect(contrast(fixed, "#faf9f6")).toBeGreaterThanOrEqual(ACCENT_CONTRAST);
    expect(contrast(fixed, "#faf9f6")).toBeLessThan(ACCENT_CONTRAST + 0.2);
  });
});

describe("warning about a chosen accent", () => {
  test("nothing chosen, nothing to warn about", () => {
    expect(accentWarning({ value: {}, styles })).toBeNull();
    expect(accentWarning({ value: { mode: "dark" }, styles })).toBeNull();
  });

  test("a new app left on Auto is not warned about: tau picks the mode to suit the colour", () => {
    expect(accentWarning({ value: { accent: NAVY }, styles })).toBeNull();
    expect(accentWarning({ value: { accent: NAVY, style: "neon" }, styles })).toBeNull();
  });

  test("a colour that will not show on the chosen page is warned about, with a shade that will", () => {
    const warning = accentWarning({ value: { accent: NAVY, mode: "dark", style: "neon" }, styles })!;
    expect(warning.mode).toBe("dark");
    expect(warning.accent).toBe(NAVY);
    expect(contrast(warning.readable, "#101014")).toBeGreaterThanOrEqual(ACCENT_CONTRAST);
    // Taking the suggestion ends the warning.
    expect(accentWarning({ value: { accent: warning.readable, mode: "dark", style: "neon" }, styles })).toBeNull();
    // The same colour on a light page is fine.
    expect(accentWarning({ value: { accent: NAVY, mode: "light", style: "soft" }, styles })).toBeNull();
    // With no style chosen, a plain page stands in.
    expect(accentWarning({ value: { accent: LEMON, mode: "light" }, styles })?.mode).toBe("light");
  });

  test("a style that outlines its accent needs no warning", () => {
    expect(accentWarning({ value: { accent: LEMON, mode: "light", style: "brutalist" }, styles })).toBeNull();
  });

  test("on a restyle the page is known, from the app and from what is being changed", () => {
    // A new colour on the app as it is.
    expect(accentWarning({ value: { accent: LEMON }, current: app(), styles })?.mode).toBe("light");
    expect(accentWarning({ value: { accent: NAVY }, current: app(), styles })).toBeNull();
    // A change of style brings that style's own mode with it.
    expect(accentWarning({ value: { accent: NAVY, style: "neon" }, current: app(), styles })?.mode).toBe("dark");
    // ...unless light or dark is chosen too.
    expect(accentWarning({ value: { accent: NAVY, style: "neon", mode: "light" }, current: app(), styles })).toBeNull();
  });

  test("an accent chosen earlier is checked against the new page too", () => {
    const current = app({ accent: NAVY });
    // Kept exactly through the restyle, so going dark would leave it unreadable.
    expect(accentWarning({ value: { style: "neon" }, current, styles, exactAccent: NAVY })?.accent).toBe(NAVY);
    expect(accentWarning({ value: { mode: "dark" }, current, styles, exactAccent: NAVY })?.mode).toBe("dark");
    // An accent tau chose is refitted to the new style, so there is nothing to say.
    expect(accentWarning({ value: { style: "neon" }, current, styles })).toBeNull();
  });
});
