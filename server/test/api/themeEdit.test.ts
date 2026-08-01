import { describe, expect, it } from "bun:test";

import {
  applyThemeEdit,
  isValidTokenValue,
  readThemeTokens,
  THEME_TOKENS,
} from "@/api/lib/themeEdit";

/**
 * An excerpt of the real theme, copied from `writeTheme()` in
 * `worker-service/src/templates/shared.ts` — every template writes these exact
 * bytes into `src/index.css`.
 *
 * The awkward parts are all deliberately present: the `@custom-variant dark`
 * line three above the `.dark` block (which a naive search for `.dark` matches
 * first), `--radius` declared only in `:root`, `:root` and `.dark` holding
 * genuinely different values for the same names, and an `@theme inline` block
 * after both that mentions every token again in `var()` form.
 */
const THEME = `@import "tailwindcss";
@import "tw-animate-css";

@custom-variant dark (&:is(.dark *));

/* :root is the LIGHT theme (active when the .dark class is absent). */
:root {
  --radius: 0.625rem;

  --background: #ffffff;
  --foreground: #121212;
  --card: #ffffff;
  --primary: #1db954;
  --primary-foreground: #000000;
  --muted: #f0f0f0;
  --muted-foreground: #6a6a6a;
  --accent: #1ed760;
  --destructive: #e22134;
  --border: #e5e5e5;
  --ring: #1db954;
}

/* .dark is the DEFAULT Spotify dark theme (html.dark is set in index.html). */
.dark {
  --background: #121212;
  --foreground: #ffffff;
  --card: #181818;
  --primary: #1db954;
  --primary-foreground: #000000;
  --muted: #282828;
  --muted-foreground: #b3b3b3;
  --accent: #1ed760;
  --destructive: #e22134;
  --border: #282828;
  --ring: #1db954;
}

@theme inline {
  --radius-lg: var(--radius);
  --color-background: var(--background);
  --color-primary: var(--primary);
}

@layer base {
  body {
    @apply bg-background text-foreground;
  }
}
`;

function edit(
  name: string,
  value: string,
  scope: "root" | "dark" = "dark",
  content = THEME,
) {
  return applyThemeEdit({ content, name, value, scope });
}

describe("readThemeTokens", () => {
  it("reads both palettes without confusing them", () => {
    const { root, dark } = readThemeTokens(THEME);
    expect(root["--background"]).toBe("#ffffff");
    expect(dark["--background"]).toBe("#121212");
    expect(root["--primary"]).toBe("#1db954");
    expect(dark["--primary"]).toBe("#1db954");
  });

  it("does not match the @custom-variant line as the .dark block", () => {
    // `@custom-variant dark (&:is(.dark *));` sits above the real block. If the
    // selector search matched it, every dark-mode read and write would land in
    // the wrong place — and silently, because the file still parses.
    const { dark } = readThemeTokens(THEME);
    expect(dark["--card"]).toBe("#181818");
  });

  it("reports --radius only where it is declared", () => {
    const { root, dark } = readThemeTokens(THEME);
    expect(root["--radius"]).toBe("0.625rem");
    expect(dark["--radius"]).toBeUndefined();
  });

  it("returns values verbatim, including forms we would not write", () => {
    // An agent may have rewritten the palette in oklch. The panel still has to
    // show the truth — a swatch the browser can render — even though a later
    // edit would decline to write that syntax.
    const oklch = THEME.replace("--primary: #1db954;", "--primary: oklch(0.7 0.2 145);");
    expect(readThemeTokens(oklch).root["--primary"]).toBe("oklch(0.7 0.2 145)");
  });

  it("copes with a file that has no theme blocks at all", () => {
    expect(readThemeTokens("body { color: red }")).toEqual({
      root: {},
      dark: {},
    });
  });
});

describe("applyThemeEdit", () => {
  it("changes exactly one line", () => {
    // Same invariant as every other visual edit: the diff reaches the user's
    // GitHub commit and the agent's USER_EDIT message. Re-printing 200 lines of
    // theme to change one colour would bury the change.
    const res = edit("--primary", "#ff0000");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const before = THEME.split("\n");
    const after = res.content.split("\n");
    expect(after.length).toBe(before.length);
    expect(after.filter((l, i) => l !== before[i])).toEqual([
      "  --primary: #ff0000;",
    ]);
  });

  it("writes the palette the user is looking at, and only that one", () => {
    // The two palettes hold genuinely different values. An "apply to both"
    // convenience would collapse light mode into dark the first time anyone
    // changed a background, so there is deliberately no such option.
    const res = edit("--background", "#0a0a0a", "dark");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.scope).toBe("dark");
    const { root, dark } = readThemeTokens(res.content);
    expect(dark["--background"]).toBe("#0a0a0a");
    expect(root["--background"]).toBe("#ffffff");
  });

  it("falls back to the other palette when the token lives in only one", () => {
    // This is what makes --radius work without a special case: the template
    // declares it once, in :root, because both themes share it.
    const res = edit("--radius", "1rem", "dark");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.scope).toBe("root");
    expect(readThemeTokens(res.content).root["--radius"]).toBe("1rem");
  });

  it("is a no-op when the value already matches", () => {
    const res = edit("--primary", "#1db954");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.content).toBe(THEME);
  });

  it("leaves the @theme inline var() references alone", () => {
    // `--color-primary: var(--primary)` mentions the token again. A search that
    // wasn't anchored on the palette blocks would happily rewrite it.
    const res = edit("--primary", "#ff0000");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.content).toContain("--color-primary: var(--primary);");
  });

  it("refuses a token that isn't declared", () => {
    const stripped = THEME.replace(/^\s*--ring:.*$/gm, "");
    expect(edit("--ring", "#ffffff", "dark", stripped)).toEqual({
      ok: false,
      reason: "token_not_found",
    });
  });

  it("refuses a file with no palettes rather than inventing one", () => {
    expect(edit("--primary", "#ffffff", "dark", "body { color: red }")).toEqual({
      ok: false,
      reason: "no_theme_block",
    });
  });

  it("refuses values that could escape the declaration", () => {
    // Hex-only is what makes this safe without escaping: none of these can be
    // written, so none of them can end a declaration early and start meaning
    // something else.
    for (const value of [
      "red; } body { display: none",
      "#fff; --border: #000",
      "url(https://evil.example/x)",
      "oklch(0.7 0.2 145)",
      "#ggg",
      "#12345",
      "",
    ]) {
      expect(edit("--primary", value).ok).toBe(false);
    }
  });

  it("accepts every hex form a colour picker produces", () => {
    for (const value of ["#fff", "#ffff", "#1db954", "#1db954ff"]) {
      expect(edit("--primary", value).ok).toBe(true);
    }
  });

  it("validates --radius as a length and colours as colours", () => {
    expect(isValidTokenValue("--radius", "0.625rem")).toBe(true);
    expect(isValidTokenValue("--radius", "12px")).toBe(true);
    expect(isValidTokenValue("--radius", "0")).toBe(true);
    expect(isValidTokenValue("--radius", "#ffffff")).toBe(false);
    expect(isValidTokenValue("--primary", "0.625rem")).toBe(false);
  });
});

describe("THEME_TOKENS", () => {
  it("are all present in the template's own theme", () => {
    // If the template's palette and this list drift, the panel offers a control
    // that always fails with token_not_found — and only for real projects, not
    // in any test that uses a hand-written fixture.
    const { root, dark } = readThemeTokens(THEME);
    for (const name of THEME_TOKENS) {
      expect(root[name] ?? dark[name]).toBeDefined();
    }
  });
});
