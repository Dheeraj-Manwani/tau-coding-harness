import type { StyleSpec } from "../types";
import { SANS_FALLBACK, SYSTEM_MONO, variableFont } from "./fonts";

const grotesk = variableFont("Hanken Grotesk", "hanken-grotesk", SANS_FALLBACK);

export const swiss: StyleSpec = {
  key: "swiss",
  name: "Swiss",
  look: "International-style precision: one grotesk typeface, a strict grid, flat colour on white, everything aligned to something.",
  suits:
    "Tools, software products, documentation, agencies, studios, institutions — anything that should feel exact, calm and confident.",
  avoid: "Not for anything that should feel warm, handmade, cosy or playful.",
  group: "precise",
  reach: "general",
  aka: ["Swiss design", "International style"],

  fonts: { display: grotesk, body: grotesk, mono: SYSTEM_MONO },
  fontOptions: [
    {
      key: "schibsted",
      label: "Schibsted Grotesk",
      fonts: {
        display: variableFont("Schibsted Grotesk", "schibsted-grotesk", SANS_FALLBACK),
        body: variableFont("Schibsted Grotesk", "schibsted-grotesk", SANS_FALLBACK),
        mono: SYSTEM_MONO,
      },
    },
    {
      key: "space",
      label: "Space Grotesk",
      fonts: {
        display: variableFont("Space Grotesk", "space-grotesk", SANS_FALLBACK),
        body: variableFont("Space Grotesk", "space-grotesk", SANS_FALLBACK),
        mono: SYSTEM_MONO,
      },
    },
  ],
  defaultMode: "light",
  dials: { variance: 5, motion: 3, density: 5 },
  radius: "0.25rem",

  palette: {
    neutralHue: "accent",
    chartHues: [180, 40, -40, 120],
    light: {
      background: { l: 1, c: 0 },
      surface: { l: 1, c: 0 },
      foreground: { l: 0.16, c: 0 },
      muted: { l: 0.962, c: 0.003 },
      mutedForeground: { l: 0.47, c: 0.004 },
      border: { l: 0.885, c: 0.003 },
      primary: { l: 0.55, c: 0.23 },
      wash: { l: 0.95, c: 0.03 },
    },
    dark: {
      background: { l: 0.14, c: 0 },
      surface: { l: 0.17, c: 0.002 },
      foreground: { l: 0.97, c: 0 },
      muted: { l: 0.22, c: 0.003 },
      mutedForeground: { l: 0.7, c: 0.004 },
      border: { l: 0.3, c: 0.004 },
      primary: { l: 0.68, c: 0.2 },
      wash: { l: 0.24, c: 0.04 },
    },
  },

  theme: {
    "--shadow-2xs": "none",
    "--shadow-xs": "none",
    "--shadow-sm": "none",
    "--shadow-md": "none",
    "--shadow-lg": "0 16px 48px -24px rgb(0 0 0 / 0.3)",
    "--shadow-xl": "0 28px 70px -32px rgb(0 0 0 / 0.38)",
  },

  baseCss: `
  h1, h2, h3, h4 {
    font-family: var(--font-heading);
    font-weight: 650;
    letter-spacing: -0.035em;
    line-height: 1.02;
  }
  body { font-feature-settings: "ss01", "tnum"; }`,

  skin: {
    controlHeight: "2.5rem",
    controlPadX: "1.125rem",
    controlRadius: "0.25rem",
    controlText: "0.875rem",
    borderWidth: "1px",
    buttonFont: "var(--font-sans)",
    buttonWeight: "600",
    buttonTracking: "-0.01em",
    buttonCase: "none",
    field: "outlined",
    fieldRadius: "0.25rem",
    fieldPadX: "0.75rem",
    cardRadius: "0.25rem",
    cardPad: "1.5rem",
    cardBorder: "1px solid var(--border)",
    cardShadow: "none",
    cardTitleSize: "1.125rem",
    cardTitleWeight: "650",
    cardTitleTracking: "-0.02em",
    badgeRadius: "0.125rem",
    badgeFont: "var(--font-sans)",
    badgeCase: "none",
    badgeTracking: "0",
    badgeWeight: "600",
    badgeText: "0.6875rem",
    badgePad: "0.1875rem 0.4375rem",
    tabs: "underline",
    tabsRadius: "0",
    overlayRadius: "0.25rem",
    overlayBorder: "1px solid var(--border)",
    overlayShadow: "var(--shadow-lg)",
    labelFont: "var(--font-sans)",
    labelCase: "none",
    labelTracking: "0",
    labelText: "0.8125rem",
    labelWeight: "600",
    checkRadius: "0.125rem",
    iconStroke: "1.75",
  },

  skinCss: `
  [data-slot="button"][data-variant="outline"] { border-color: var(--foreground); }
  [data-slot="button"][data-variant="outline"]:hover { background: var(--foreground); color: var(--background); }
  [data-slot="input"]:focus-visible,
  [data-slot="textarea"]:focus-visible,
  [data-slot="select-trigger"]:focus-visible { border-color: var(--foreground); box-shadow: 0 0 0 1px var(--foreground); }`,

  layouts: [
    "split-hero",
    "full-bleed-bands",
    "index-list",
    "poster",
    "sidebar-shell",
    "topbar-workspace",
    "dashboard-grid",
    "master-detail",
    "split-tool",
    "focus-column",
  ],

  prose: {
    overview:
      "This app follows the Swiss tradition: a grid you can feel, one typeface doing everything through size and weight, and colour used flat and on purpose. Nothing is decorative. If an element does not help someone read or act, it is not there.",
    colors:
      "White, black, and one saturated accent. The accent is for the single most important action or figure on a screen and for nothing else. Use greys only for borders and secondary text.",
    typography:
      "One grotesk. Headings are heavy, tight and large; body is regular. Create hierarchy with big jumps in size — a 5:1 ratio between the largest and smallest text on a screen is right — rather than with colour. Set all numbers in tabular figures and right-align them in columns.",
    layout:
      "Work on a 12-column grid and let every edge line up with another edge. Prefer asymmetric splits (8/4, 7/5) over halves and thirds. Leave whole columns empty rather than spreading content to fill the width.",
    elevation:
      "Flat. Surfaces are separated by a one-pixel border, never a shadow. Only overlays — dialogs, menus — lift off the page.",
    shapes: "Corners are barely rounded (4px). Lines are one pixel, in grey for structure and black for emphasis.",
    components: {
      button: "a solid block with a medium-weight label; the outline variant has a black border and inverts on hover.",
      card: "a white rectangle with a thin grey border and no shadow.",
      input: "a thin-bordered box whose border turns black on focus.",
      badge: "a small, nearly square label in semibold.",
      tabs: "words in a row with a line under the active one.",
      dialog: "a thin-bordered sheet with a soft shadow.",
    },
    icons: "Line icons at 16–20px, aligned to the text baseline. Use them to label actions, not to fill space.",
    dos: [
      "Align every element to the grid; check that left edges match down the page.",
      "Use very large, tight headings next to small body text.",
      "Use one accent-coloured element per screen.",
      "Show data in plain ruled tables with right-aligned numbers.",
    ],
    donts: [
      "Don't use gradients, shadows on cards, or background tints to decorate.",
      "Don't centre everything; left-align and let the right side stay ragged.",
      "Don't use the accent for more than one thing at a time.",
      "Don't round corners beyond what the components already have.",
    ],
  },
};
