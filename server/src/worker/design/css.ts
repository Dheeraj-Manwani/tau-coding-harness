/**
 * `src/index.css` for a designed app.
 *
 * One file carries the whole look, in four parts:
 *
 *   1. **The palette** — `:root` (light) and `.dark`, flat hex declarations.
 *      Same shape as `templates/theme.ts` writes, because the theme panel finds
 *      tokens by that shape (`api/lib/themeEdit.ts`).
 *   2. **Theme tokens** — fonts, radius scale, shadow scale, type scale and the
 *      spacing unit. Tailwind v4 reads all of these from CSS variables, so
 *      overriding them restyles every utility that uses them — `shadow-sm` is a
 *      blur in one style and a hard offset block in another.
 *   3. **Base rules** — body and headings.
 *   4. **The skin** — rules keyed on the `data-slot` attribute every stock
 *      shadcn component carries, in a cascade layer declared after Tailwind's
 *      own so it wins over the components' built-in classes.
 *
 * ## Why a skin instead of rewriting the components
 *
 * Different colours and fonts on the stock shadcn shapes still read as "a
 * shadcn app" — the same silhouette every other builder ships. Changing the
 * silhouette means changing height, corner, border, casing, shadow and press
 * behaviour per component. Doing that by replacing component files would tie
 * every style to one version of each file and leave any component added later
 * (`shadcn add …`) unstyled. Doing it in CSS, against `data-slot`, restyles
 * whatever is there, survives upgrades, and makes a restyle a one-file swap.
 *
 * It is also the enforcement: because the layer outranks utilities, a
 * `rounded-full` an agent adds to a `<Button>` in a square-cornered style does
 * nothing. The style's shape is not something a class can argue with.
 *
 * Pure. See doc/CONTEXT_AND_MEMORY_PLAN.md §5.
 */
import { THEME_COLOR_TOKENS, type Palette, type Theme } from "../templates/theme";
import { TABS_LIST, TABS_TAB } from "./styles/selectors";
import type { Dials, FontRef, Mode, SkinVars, StyleSpec } from "./types";

function declarations(palette: Palette): string {
  return THEME_COLOR_TOKENS.map((name) => `  --${name}: ${palette[name]};`).join("\n");
}

/**
 * The spacing unit for a density, 1 (airy) to 10 (packed).
 *
 * Every Tailwind spacing utility is a multiple of `--spacing`, so this one
 * number tightens or loosens padding, gaps and control sizes across the whole
 * app, including everything the agent writes later. Text sizes are separate
 * and do not shrink with it.
 */
export function spacingUnit(density: number): string {
  const d = Math.min(10, Math.max(1, density));
  return `${(0.285 - (d - 1) * 0.0075).toFixed(4)}rem`;
}

/** Each font's CSS files, once, in a stable order. */
export function fontImports(fonts: StyleSpec["fonts"]): string[] {
  const seen = new Set<string>();
  for (const font of [fonts.display, fonts.body, fonts.mono] as FontRef[]) {
    for (const spec of font.imports ?? []) seen.add(spec);
  }
  return [...seen];
}

function fieldRules(v: SkinVars): string {
  const fields = `[data-slot="input"], [data-slot="textarea"], [data-slot="select-trigger"]`;
  const focus = `[data-slot="input"]:focus-visible, [data-slot="textarea"]:focus-visible, [data-slot="select-trigger"]:focus-visible`;
  if (v.field === "underline") {
    return `
  ${fields} {
    border-width: 0 0 var(--border-w) 0;
    border-color: var(--foreground);
    border-radius: 0;
    background: transparent;
    padding-inline: 0;
    box-shadow: none;
  }
  ${focus} {
    border-color: var(--primary);
    box-shadow: 0 1px 0 0 var(--primary);
  }`;
  }
  if (v.field === "filled") {
    return `
  ${fields} {
    border-width: var(--border-w);
    border-color: transparent;
    border-radius: var(--field-radius);
    background: var(--muted);
    padding-inline: var(--field-px);
  }
  ${focus} {
    background: var(--card);
    border-color: var(--ring);
  }`;
  }
  return `
  ${fields} {
    border-width: var(--border-w);
    border-radius: var(--field-radius);
    padding-inline: var(--field-px);
  }`;
}

function tabsRules(v: SkinVars): string {
  // Only horizontal tab bars are reshaped; a vertical list keeps its stock form.
  const list = TABS_LIST;
  const tab = TABS_TAB;
  if (v.tabs === "underline") {
    return `
  ${list} {
    display: flex;
    width: 100%;
    height: auto;
    justify-content: flex-start;
    gap: 1.75rem;
    padding: 0;
    background: transparent;
    border-radius: 0;
    border-bottom: 1px solid var(--border);
  }
  ${tab} {
    flex: none;
    height: auto;
    padding: 0.625rem 0;
    margin-bottom: -1px;
    border: 0;
    border-bottom: 2px solid transparent;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
  }
  ${tab}[data-active] {
    border-bottom-color: var(--foreground);
    color: var(--foreground);
    background: transparent;
  }
  ${tab}::after { display: none; }`;
  }
  if (v.tabs === "boxed") {
    return `
  ${list} {
    height: auto;
    gap: 0;
    padding: 0;
    background: transparent;
    border-radius: 0;
  }
  ${tab} {
    height: auto;
    padding: 0.5rem 1rem;
    border: var(--border-w) solid var(--foreground);
    border-radius: 0;
    background: var(--card);
    color: var(--foreground);
    box-shadow: none;
  }
  ${tab} + [data-slot="tabs-trigger"] { margin-left: calc(var(--border-w) * -1); }
  ${tab}[data-active] {
    background: var(--foreground);
    color: var(--background);
  }`;
  }
  return `
  ${list} {
    height: auto;
    padding: 0.25rem;
    border-radius: var(--tabs-radius);
    background: var(--muted);
  }
  ${tab} {
    height: auto;
    padding: 0.375rem 0.875rem;
    border-radius: calc(var(--tabs-radius) - 0.25rem);
  }
  ${tab}[data-active] {
    background: var(--card);
    color: var(--foreground);
    box-shadow: var(--shadow-xs);
  }`;
}

/** The rules every style shares, driven by the style's skin variables. */
function sharedSkin(v: SkinVars): string {
  // A style with square controls has square toggles and avatars too.
  const round = v.checkRadius === "0" ? "0" : "9999px";

  return `
  :root {
    --control-h: ${v.controlHeight};
    --control-px: ${v.controlPadX};
    --control-radius: ${v.controlRadius};
    --control-text: ${v.controlText};
    --border-w: ${v.borderWidth};
    --field-radius: ${v.fieldRadius};
    --field-px: ${v.fieldPadX};
    --card-radius: ${v.cardRadius};
    --card-pad: ${v.cardPad};
    --tabs-radius: ${v.tabsRadius};
    --overlay-radius: ${v.overlayRadius};
    --icon-size: ${v.iconSize};
  }

  .lucide { stroke-width: ${v.iconStroke}; }

  [data-slot="button"] {
    border-radius: var(--control-radius);
    border-width: var(--border-w);
    font-family: ${v.buttonFont};
    font-weight: ${v.buttonWeight};
    letter-spacing: ${v.buttonTracking};
    text-transform: ${v.buttonCase};
  }
  [data-slot="button"][data-size="default"] { height: var(--control-h); padding-inline: var(--control-px); font-size: var(--control-text); }
  [data-slot="button"][data-size="lg"] { height: calc(var(--control-h) + 0.5rem); padding-inline: calc(var(--control-px) + 0.5rem); font-size: calc(var(--control-text) + 0.0625rem); }
  [data-slot="button"][data-size="sm"] { height: calc(var(--control-h) - 0.375rem); padding-inline: calc(var(--control-px) - 0.25rem); font-size: calc(var(--control-text) - 0.0625rem); }
  [data-slot="button"][data-size="xs"] { height: calc(var(--control-h) - 0.75rem); padding-inline: calc(var(--control-px) - 0.5rem); font-size: calc(var(--control-text) - 0.125rem); }
  [data-slot="button"][data-size="icon"] { width: var(--control-h); height: var(--control-h); }
  [data-slot="button"][data-size="icon-lg"] { width: calc(var(--control-h) + 0.5rem); height: calc(var(--control-h) + 0.5rem); }
  [data-slot="button"][data-size="icon-sm"] { width: calc(var(--control-h) - 0.375rem); height: calc(var(--control-h) - 0.375rem); }
  [data-slot="button"][data-size="icon-xs"] { width: calc(var(--control-h) - 0.75rem); height: calc(var(--control-h) - 0.75rem); }
  [data-slot="button"][data-variant="link"] { height: auto; padding: 0; border-width: 0; }
${fieldRules(v)}
  [data-slot="input"], [data-slot="select-trigger"] { height: var(--control-h); }
  [data-slot="textarea"] { padding-block: 0.625rem; }

  [data-slot="card"] {
    border-radius: var(--card-radius);
    border: ${v.cardBorder};
    box-shadow: ${v.cardShadow};
    --card-spacing: var(--card-pad);
  }
  [data-slot="card"][data-size="sm"] { --card-spacing: calc(var(--card-pad) * 0.7); }
  /* In a row of cards stretched to one height, the footer belongs at the bottom. */
  [data-slot="card-footer"] { margin-top: auto; }
  [data-slot="card-title"] {
    font-family: var(--font-heading);
    font-size: ${v.cardTitleSize};
    font-weight: ${v.cardTitleWeight};
    letter-spacing: ${v.cardTitleTracking};
    line-height: 1.2;
  }

  [data-slot="badge"] {
    height: auto;
    padding: ${v.badgePad};
    border-radius: ${v.badgeRadius};
    font-family: ${v.badgeFont};
    font-size: ${v.badgeText};
    font-weight: ${v.badgeWeight};
    letter-spacing: ${v.badgeTracking};
    text-transform: ${v.badgeCase};
    line-height: 1.3;
  }
${tabsRules(v)}

  [data-slot="dialog-content"], [data-slot="alert-dialog-content"], [data-slot="popover-content"],
  [data-slot="dropdown-menu-content"], [data-slot="select-content"] {
    border-radius: var(--overlay-radius);
    border: ${v.overlayBorder};
    box-shadow: ${v.overlayShadow};
  }
  [data-slot="sheet-content"] { border: ${v.overlayBorder}; box-shadow: ${v.overlayShadow}; }
  [data-slot="dialog-title"], [data-slot="alert-dialog-title"], [data-slot="sheet-title"] {
    font-family: var(--font-heading);
  }

  [data-slot="label"], [data-slot="table-head"] {
    font-family: ${v.labelFont};
    font-size: ${v.labelText};
    font-weight: ${v.labelWeight};
    letter-spacing: ${v.labelTracking};
    text-transform: ${v.labelCase};
  }

  [data-slot="checkbox"] { border-radius: ${v.checkRadius}; border-width: var(--border-w); }
  [data-slot="switch"], [data-slot="switch-thumb"] { border-radius: ${round}; }
  [data-slot="avatar"], [data-slot="avatar-image"], [data-slot="avatar-fallback"] { border-radius: ${round}; }`;
}

/**
 * The page backdrop of a style that has one, as a base rule.
 *
 * Drawn on a fixed layer behind the page rather than as `body`'s own
 * background, so it stays put while the page scrolls on every browser — a
 * fixed background on `body` scrolls away on phones.
 */
function backdropBase(backdrop: string | undefined): string {
  if (!backdrop) return "";
  return `
  body::before {
    content: "";
    position: fixed;
    inset: 0;
    z-index: -1;
    pointer-events: none;
    background: ${backdrop};
  }`;
}

/**
 * What keeps a backdrop visible. Nearly every app wraps its screens in a
 * full-height `bg-background` element, which would paint the page colour over
 * the backdrop and leave the style looking like it has none. Those wrappers
 * are made see-through; the page colour is still there, on `body`.
 */
function backdropSkin(backdrop: string | undefined): string {
  if (!backdrop) return "";
  return `

  #root > .bg-background, .min-h-screen.bg-background, .min-h-svh.bg-background, .min-h-dvh.bg-background {
    background-color: transparent;
  }`;
}

export interface DesignCssInput {
  style: StyleSpec;
  theme: Theme;
  mode: Mode;
  dials: Dials;
  /**
   * Whether the style's font packages are installed in the app. When they are
   * not (the install failed), the imports are left out and the font stacks
   * fall through to system fonts — plainer, but not broken.
   */
  fontsInstalled: boolean;
}

/** The full `src/index.css`, ending in a newline. */
export function buildDesignCss(input: DesignCssInput): string {
  const { style, theme, mode, dials } = input;

  const imports = input.fontsInstalled
    ? fontImports(style.fonts).map((spec) => `@import "${spec}";`)
    : [];

  const colorMappings = THEME_COLOR_TOKENS.map(
    (name) => `  --color-${name}: var(--${name});`,
  ).join("\n");

  const themeTokens = Object.entries(style.theme)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join("\n");

  const opens =
    mode === "dark"
      ? `The app opens dark: index.html has <html class="dark">. Remove that class for light.`
      : `The app opens light. Add class="dark" to <html> in index.html for dark.`;

  return `@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";
${imports.length > 0 ? `${imports.join("\n")}\n` : ""}
@custom-variant dark (&:is(.dark *));

/* This file is the app's look: the ${style.name} style, written by tau from
   .tau/DESIGN.md. Colours are the two blocks below; change a value here and
   every component follows. Keep both blocks, one flat "--name: value;" per
   line, colours as hex — tau's theme panel edits them in this shape.
   ${opens} */

/* Light palette. */
:root {
  --radius: ${theme.radius};

${declarations(theme.light)}
}

/* Dark palette. */
.dark {
${declarations(theme.dark)}
}

@theme inline {
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);

${colorMappings}

  --font-sans: ${style.fonts.body.stack};
  --font-heading: ${style.fonts.display.stack};
  --font-display: ${style.fonts.display.stack};
  --font-mono: ${style.fonts.mono.stack};

  /* Every spacing utility is a multiple of this. Density ${dials.density}/10. */
  --spacing: ${spacingUnit(dials.density)};

${themeTokens}
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  html {
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }
  body {
    @apply bg-background text-foreground font-sans;
  }
  /* An icon nothing has sized is the style's size, not lucide's 24px. In the
     base layer so that any size class wins, and only for the default size so
     that a size prop does too. */
  .lucide[width="24"][height="24"] {
    width: var(--icon-size);
    height: var(--icon-size);
  }
${(style.baseCss + backdropBase(style.backdrop)).replace(/^\n/, "")}
}

/* The component skin. It restyles the stock shadcn components by their
   data-slot attribute, and sits in a layer after Tailwind's so it outranks the
   classes on the components themselves. Shape, border, casing and shadow of a
   Button, Card, Input, Badge, Tabs or Dialog come from here — to change one,
   change it here, not with classes where it is used. */
@layer skin {${sharedSkin(style.skin)}
${style.skinCss.replace(/^\n/, "")}${backdropSkin(style.backdrop)}
}

/* People who ask their system for less motion get none. */
@media (prefers-reduced-motion: reduce) {
  *, ::before, ::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
`;
}
