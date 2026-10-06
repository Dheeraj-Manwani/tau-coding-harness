/**
 * `src/index.css` for a generated app, built from a palette instead of written
 * out by hand.
 *
 * `writeTheme()` in `shared.ts` is the generation-1 theme: one Spotify palette,
 * inlined as a heredoc, baked into every image. This is the same file shape
 * with the values lifted out, so a palette is data — the generation-2 image
 * bakes `NEUTRAL_THEME`, and a later phase writes a per-project palette at
 * provision time through the same function (doc/CONTEXT_AND_MEMORY_PLAN.md §5).
 *
 * The shape is load-bearing, not incidental. `api/lib/themeEdit.ts` finds a
 * token by looking for a `:root {` block and a `.dark {` block holding flat
 * `--name: value;` declarations, and it only *writes* hex. So: keep both blocks,
 * keep the declarations flat, keep the values hex. `test/worker/theme.test.ts`
 * round-trips this output through the theme panel's own parser.
 *
 * Pure and runtime-safe: no `e2b` import, so the worker can call it without
 * pulling the build-time `Template()` graph.
 */

/** Every colour variable the theme declares, in the order it is written. */
export const THEME_COLOR_TOKENS = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "border",
  "input",
  "ring",
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
  "sidebar",
  "sidebar-foreground",
  "sidebar-primary",
  "sidebar-primary-foreground",
  "sidebar-accent",
  "sidebar-accent-foreground",
  "sidebar-border",
  "sidebar-ring",
] as const;

export type ThemeColorToken = (typeof THEME_COLOR_TOKENS)[number];

/** One hex value per colour token. */
export type Palette = Record<ThemeColorToken, string>;

export interface Theme {
  /** Shared by both modes, so it is declared once, in `:root`. */
  radius: string;
  light: Palette;
  dark: Palette;
}

function declarations(palette: Palette): string {
  return THEME_COLOR_TOKENS.map((name) => `  --${name}: ${palette[name]};`).join(
    "\n",
  );
}

/** The full `src/index.css`, ending in a newline. */
export function buildThemeCss(theme: Theme): string {
  const colorMappings = THEME_COLOR_TOKENS.map(
    (name) => `  --color-${name}: var(--${name});`,
  ).join("\n");

  // `shadcn/tailwind.css` is not optional decoration: the stock components'
  // classes use variants it defines (`data-horizontal:`, `data-active:` …) and
  // keyframes it declares. Without it, tabs lay out sideways and accordions
  // do not animate.
  return `@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";

@custom-variant dark (&:is(.dark *));

/* :root is the LIGHT theme (active when the .dark class is absent). The app
   ships dark by default via <html class="dark">; this block exists so a theme
   switcher / light-mode request works by simply toggling that class. */
:root {
  --radius: ${theme.radius};

${declarations(theme.light)}
}

/* .dark is the DEFAULT theme (html.dark is set in index.html). */
.dark {
${declarations(theme.dark)}
}

@theme inline {
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);

${colorMappings}
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
  }
}
`;
}

/**
 * The generation-2 starting palette: grayscale, no brand colour.
 *
 * Deliberately a blank rather than a design. Generation 1 baked one opinionated
 * palette into every image, which is why every app it produced started out the
 * same green; here the colour is chosen per app (by the agent today, by the
 * project's style once that lands). The only hues are the destructive red and
 * the chart series, which have to be distinguishable to mean anything.
 */
export const NEUTRAL_THEME: Theme = {
  radius: "0.625rem",
  light: {
    background: "#ffffff",
    foreground: "#0a0a0a",
    card: "#ffffff",
    "card-foreground": "#0a0a0a",
    popover: "#ffffff",
    "popover-foreground": "#0a0a0a",
    primary: "#171717",
    "primary-foreground": "#fafafa",
    secondary: "#f5f5f5",
    "secondary-foreground": "#171717",
    muted: "#f5f5f5",
    "muted-foreground": "#737373",
    accent: "#f5f5f5",
    "accent-foreground": "#171717",
    destructive: "#e7000b",
    border: "#e5e5e5",
    input: "#e5e5e5",
    ring: "#a1a1a1",
    "chart-1": "#f54900",
    "chart-2": "#009689",
    "chart-3": "#104e64",
    "chart-4": "#ffb900",
    "chart-5": "#fe9a00",
    sidebar: "#fafafa",
    "sidebar-foreground": "#0a0a0a",
    "sidebar-primary": "#171717",
    "sidebar-primary-foreground": "#fafafa",
    "sidebar-accent": "#f5f5f5",
    "sidebar-accent-foreground": "#171717",
    "sidebar-border": "#e5e5e5",
    "sidebar-ring": "#a1a1a1",
  },
  dark: {
    background: "#0a0a0a",
    foreground: "#fafafa",
    card: "#171717",
    "card-foreground": "#fafafa",
    popover: "#262626",
    "popover-foreground": "#fafafa",
    primary: "#e5e5e5",
    "primary-foreground": "#171717",
    secondary: "#262626",
    "secondary-foreground": "#fafafa",
    muted: "#262626",
    "muted-foreground": "#a1a1a1",
    accent: "#262626",
    "accent-foreground": "#fafafa",
    destructive: "#ff6467",
    border: "#262626",
    input: "#404040",
    ring: "#737373",
    "chart-1": "#1447e6",
    "chart-2": "#00bc7d",
    "chart-3": "#fe9a00",
    "chart-4": "#ad46ff",
    "chart-5": "#ff2056",
    sidebar: "#171717",
    "sidebar-foreground": "#fafafa",
    "sidebar-primary": "#e5e5e5",
    "sidebar-primary-foreground": "#171717",
    "sidebar-accent": "#262626",
    "sidebar-accent-foreground": "#fafafa",
    "sidebar-border": "#262626",
    "sidebar-ring": "#737373",
  },
};
