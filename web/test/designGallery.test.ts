import { describe, expect, test } from "bun:test";

import {
  groupStyles,
  searchStyles,
  type CatalogStyle,
  type StyleGroup,
} from "../src/features/design/api";

// The style gallery holds about twenty looks. It is shown in families and can
// be searched, and a look has to be findable under the name people know it by
// as well as the one tau gives it.

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
  sampleAccent: "#f00",
  ...over,
});

const STYLES = [
  style({ key: "swiss", name: "Swiss", aka: ["Swiss design"], look: "One grotesk, a strict grid.", suits: "Tools and documentation." }),
  style({ key: "brutalist", name: "Brutalist", aka: ["Neo-brutalism"], group: "loud", look: "Thick outlines.", suits: "Zines and events." }),
  style({ key: "glass", name: "Glass", aka: ["Glassmorphism"], group: "tactile", look: "Frosted panels.", suits: "Health dashboards." }),
  style({ key: "workbench", name: "Workbench", look: "Dense and tabular.", suits: "Admin tools and dashboards." }),
];

const GROUPS: StyleGroup[] = [
  { key: "precise", label: "Clean", title: "Clean and precise" },
  { key: "tactile", label: "Tactile", title: "Soft and tactile" },
  { key: "loud", label: "Bold", title: "Bold and playful" },
  { key: "tech", label: "Futuristic", title: "Technical and futuristic" },
];

const keys = (styles: CatalogStyle[]) => styles.map((s) => s.key);

describe("searching the gallery", () => {
  test("nothing typed is everything", () => {
    expect(searchStyles(STYLES, "")).toBe(STYLES);
    expect(searchStyles(STYLES, "   ")).toBe(STYLES);
  });

  test("finds a look by the name people know it by", () => {
    expect(keys(searchStyles(STYLES, "glassmorphism"))).toEqual(["glass"]);
    expect(keys(searchStyles(STYLES, "Neo-Brutalism"))).toEqual(["brutalist"]);
    expect(keys(searchStyles(STYLES, "swiss"))).toEqual(["swiss"]);
  });

  test("finds looks by what they suit, and needs every word to match", () => {
    expect(keys(searchStyles(STYLES, "dashboard"))).toEqual(["glass", "workbench"]);
    expect(keys(searchStyles(STYLES, "admin dashboards"))).toEqual(["workbench"]);
    expect(searchStyles(STYLES, "vaporwave")).toEqual([]);
  });
});

describe("showing the gallery in families", () => {
  test("follows the catalog's order of families, and of styles within each", () => {
    const sections = groupStyles(STYLES, GROUPS);
    expect(sections.map((s) => s.group.key)).toEqual(["precise", "tactile", "loud"]);
    expect(keys(sections[0]!.styles)).toEqual(["swiss", "workbench"]);
  });

  test("a family with nothing to show is left out", () => {
    const sections = groupStyles(searchStyles(STYLES, "glass"), GROUPS);
    expect(sections.map((s) => s.group.title)).toEqual(["Soft and tactile"]);
  });

  test("a style in a family the catalog does not list still appears", () => {
    const stray = style({ key: "new", group: "unheard-of" });
    const sections = groupStyles([...STYLES, stray], GROUPS);
    expect(keys(sections.at(-1)!.styles)).toEqual(["new"]);
    // With no families at all, the gallery is one section.
    expect(groupStyles(STYLES, [])).toHaveLength(1);
    expect(groupStyles([], GROUPS)).toEqual([]);
  });
});
