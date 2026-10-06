import { describe, expect, test } from "bun:test";
import {
  applyThemeEdit,
  isValidTokenValue,
  readThemeTokens,
  THEME_TOKENS,
} from "@/api/lib/themeEdit";
import { buildAppMemoryMd } from "@/worker/templates/shared";
import {
  NEUTRAL_THEME,
  THEME_COLOR_TOKENS,
  buildThemeCss,
} from "@/worker/templates/theme";

// The generation-2 image writes `src/index.css` from a palette rather than from
// a hand-written heredoc. The theme panel (`api/lib/themeEdit.ts`) parses that
// file by its shape, so the generated file has to keep the shape the
// hand-written one had. These run the real parser over the real output.

const css = buildThemeCss(NEUTRAL_THEME);

describe("buildThemeCss", () => {
  test("every token the theme panel offers can be read back, in both palettes", () => {
    const { root, dark } = readThemeTokens(css);
    for (const name of THEME_TOKENS) {
      // `--radius` is shared by both modes, so it is declared once, in `:root`.
      if (name !== "--radius") expect(dark[name]).toBeDefined();
      expect(root[name]).toBeDefined();
    }
    expect(dark["--radius"]).toBeUndefined();
  });

  test("the values read back are the palette's values", () => {
    const { root, dark } = readThemeTokens(css);
    expect(root["--primary"]).toBe(NEUTRAL_THEME.light.primary);
    expect(dark["--primary"]).toBe(NEUTRAL_THEME.dark.primary);
    expect(root["--background"]).toBe(NEUTRAL_THEME.light.background);
    expect(dark["--background"]).toBe(NEUTRAL_THEME.dark.background);
    expect(root["--radius"]).toBe(NEUTRAL_THEME.radius);
  });

  test("every value is one the theme panel would be willing to write", () => {
    // The panel reads anything but only writes hex. A palette in another colour
    // syntax would render fine and then be impossible to put back.
    for (const palette of [NEUTRAL_THEME.light, NEUTRAL_THEME.dark]) {
      for (const name of THEME_COLOR_TOKENS) {
        expect(isValidTokenValue(`--${name}`, palette[name])).toBe(true);
      }
    }
    expect(isValidTokenValue("--radius", NEUTRAL_THEME.radius)).toBe(true);
  });

  test("a theme-panel edit lands in the palette it was aimed at", () => {
    const edited = applyThemeEdit({
      content: css,
      name: "--primary",
      value: "#ff00aa",
      scope: "dark",
    });
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(edited.scope).toBe("dark");
    const after = readThemeTokens(edited.content);
    expect(after.dark["--primary"]).toBe("#ff00aa");
    expect(after.root["--primary"]).toBe(NEUTRAL_THEME.light.primary);
  });

  test("maps every colour token into Tailwind's theme", () => {
    for (const name of THEME_COLOR_TOKENS) {
      expect(css).toContain(`--color-${name}: var(--${name});`);
    }
  });

  test("ends with a newline, so a heredoc terminator lands on its own line", () => {
    expect(css.endsWith("\n")).toBe(true);
  });
});

describe("the neutral palette", () => {
  test("carries no brand colour", () => {
    // Generation 1 baked Spotify green into every app. The base palette is a
    // blank on purpose: primary and accent are greys.
    const isGrey = (hex: string) =>
      /^#([0-9a-f]{2})\1\1$/i.test(hex);
    for (const palette of [NEUTRAL_THEME.light, NEUTRAL_THEME.dark]) {
      expect(isGrey(palette.primary)).toBe(true);
      expect(isGrey(palette.accent)).toBe(true);
      expect(isGrey(palette.background)).toBe(true);
    }
    expect(css.toLowerCase()).not.toContain("#1db954");
  });
});

describe("buildAppMemoryMd", () => {
  const md = buildAppMemoryMd();

  test("is app memory only — no template manifest and no marker", () => {
    expect(md).not.toContain("STATIC");
    expect(md).not.toContain("DYNAMIC");
    expect(md).not.toContain("Pre-installed");
  });

  test("has the sections the agent is told to keep current", () => {
    for (const heading of [
      "## What this app is",
      "## Routes and where they live",
      "## Data model",
      "## Decisions and why",
      "## User preferences",
      "## Known issues",
    ]) {
      expect(md).toContain(heading);
    }
  });

  test("survives the heredoc it is written with", () => {
    // Written as `cat > file <<'EOF'\n${md}EOF`: a line that is exactly `EOF`
    // would end the file early, and a missing trailing newline would glue the
    // terminator onto the last line.
    expect(md.endsWith("\n")).toBe(true);
    expect(md.split("\n")).not.toContain("EOF");
  });
});
