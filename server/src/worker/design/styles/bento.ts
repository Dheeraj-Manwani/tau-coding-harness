import type { StyleSpec } from "../types";
import { MONO_FALLBACK, SANS_FALLBACK, variableFont } from "./fonts";

export const bento: StyleSpec = {
  key: "bento",
  name: "Bento",
  look: "Modern product polish: a grid of rounded tiles on a soft grey page, quiet borders, a crisp grotesk, big numbers.",
  suits:
    "Product and feature pages, personal dashboards, analytics, trackers, link-in-bio pages, anything that shows several things of equal weight at once.",
  avoid: "Not for long reading, or for anything that should feel handmade or traditional.",

  fonts: {
    display: variableFont("Manrope", "manrope", SANS_FALLBACK),
    body: variableFont("Onest", "onest", SANS_FALLBACK),
    mono: variableFont("Geist Mono", "geist-mono", MONO_FALLBACK),
  },
  defaultMode: "light",
  dials: { variance: 6, motion: 5, density: 5 },
  radius: "0.875rem",

  palette: {
    neutralHue: "accent",
    chartHues: [45, -45, 150, 200],
    light: {
      background: { l: 0.962, c: 0.006 },
      surface: { l: 1, c: 0 },
      foreground: { l: 0.2, c: 0.012 },
      muted: { l: 0.94, c: 0.008 },
      mutedForeground: { l: 0.5, c: 0.012 },
      border: { l: 0.9, c: 0.008 },
      primary: { l: 0.55, c: 0.2 },
      wash: { l: 0.948, c: 0.03 },
    },
    dark: {
      background: { l: 0.155, c: 0.008 },
      surface: { l: 0.2, c: 0.01 },
      foreground: { l: 0.96, c: 0.006 },
      muted: { l: 0.25, c: 0.01 },
      mutedForeground: { l: 0.7, c: 0.012 },
      border: { l: 0.29, c: 0.012 },
      primary: { l: 0.7, c: 0.17 },
      wash: { l: 0.27, c: 0.04 },
    },
  },

  theme: {
    "--shadow-2xs": "0 1px 0 0 rgb(0 0 0 / 0.03)",
    "--shadow-xs": "0 1px 2px 0 rgb(0 0 0 / 0.05)",
    "--shadow-sm": "0 2px 6px -2px rgb(0 0 0 / 0.08), 0 1px 2px 0 rgb(0 0 0 / 0.04)",
    "--shadow-md": "0 8px 24px -10px rgb(0 0 0 / 0.14), 0 2px 4px -2px rgb(0 0 0 / 0.05)",
    "--shadow-lg": "0 20px 48px -20px rgb(0 0 0 / 0.24)",
    "--shadow-xl": "0 32px 72px -28px rgb(0 0 0 / 0.32)",
  },

  baseCss: `
  h1, h2, h3, h4 {
    font-family: var(--font-heading);
    font-weight: 700;
    letter-spacing: -0.035em;
    line-height: 1.05;
  }`,

  skin: {
    controlHeight: "2.5rem",
    controlPadX: "1.125rem",
    controlRadius: "0.75rem",
    controlText: "0.875rem",
    borderWidth: "1px",
    buttonFont: "var(--font-sans)",
    buttonWeight: "600",
    buttonTracking: "-0.01em",
    buttonCase: "none",
    field: "outlined",
    fieldRadius: "0.75rem",
    fieldPadX: "0.875rem",
    cardRadius: "1.5rem",
    cardPad: "1.5rem",
    cardBorder: "1px solid var(--border)",
    cardShadow: "var(--shadow-xs)",
    cardTitleSize: "1rem",
    cardTitleWeight: "600",
    cardTitleTracking: "-0.02em",
    badgeRadius: "9999px",
    badgeFont: "var(--font-sans)",
    badgeCase: "none",
    badgeTracking: "0",
    badgeWeight: "600",
    badgeText: "0.75rem",
    badgePad: "0.1875rem 0.625rem",
    tabs: "segmented",
    tabsRadius: "0.75rem",
    overlayRadius: "1.25rem",
    overlayBorder: "1px solid var(--border)",
    overlayShadow: "var(--shadow-xl)",
    labelFont: "var(--font-sans)",
    labelCase: "none",
    labelTracking: "0",
    labelText: "0.8125rem",
    labelWeight: "500",
    checkRadius: "0.375rem",
    iconStroke: "1.75",
  },

  skinCss: `
  [data-slot="card"] { transition: transform 200ms ease, box-shadow 200ms ease; }
  a[data-slot="card"]:hover, button[data-slot="card"]:hover { transform: translateY(-2px); box-shadow: var(--shadow-md); }
  [data-slot="card-footer"] { background: transparent; }
  [data-slot="button"][data-variant="default"] { box-shadow: inset 0 1px 0 0 rgb(255 255 255 / 0.18), var(--shadow-xs); }
  [data-slot="button"][data-variant="outline"] { background: var(--card); }
  [data-slot="input"], [data-slot="textarea"], [data-slot="select-trigger"] { background: var(--card); }
  [data-slot="badge"][data-variant="secondary"], [data-slot="badge"][data-variant="outline"] { background: var(--muted); border-color: transparent; }`,

  layouts: [
    "bento",
    "split-hero",
    "full-bleed-bands",
    "dashboard-grid",
    "sidebar-shell",
    "topbar-workspace",
    "focus-column",
    "master-detail",
    "board",
  ],

  prose: {
    overview:
      "This app is built from tiles. A soft grey page holds white, generously rounded panels of different sizes, each one a self-contained fact, figure or control. It should read like the feature grid of a current product launch: tidy, confident, a little dense with information but never cluttered.",
    colors:
      "A cool pale grey page, white tiles, near-black text, and one accent. The accent appears on the primary action and as the highlight inside one or two tiles — a figure, a chart line, a filled tile — never on all of them.",
    typography:
      "Headings in a tight, heavy geometric sans; body in a clean neutral sans. The signature move is the big number: set key figures at 3–5× the size of their label, in the display face, with the label small and grey above or below. Use the monospace face for figures in tables and for small technical labels.",
    layout:
      "Compose with a CSS grid of 4, 6 or 12 columns and let tiles span different numbers of columns and rows (`col-span-2 row-span-2`). Make one tile clearly the largest. Keep the gap between tiles constant (`gap-4`), and give every tile the same inner padding.",
    elevation:
      "Tiles sit almost flat: a hairline border and the faintest shadow. A tile that can be clicked lifts slightly on hover. Overlays carry a deep, soft shadow.",
    shapes: "Tiles have large 24px corners; controls inside them have 12px corners; tags are pills. Nested corners always get smaller as they go inward.",
    components: {
      button: "a rounded block with a faint top highlight; the outline variant is white with a hairline border.",
      card: "a white tile with 24px corners, a hairline border and a whisper of shadow. This is the main building block — size it with grid spans.",
      input: "a white rounded field with a hairline border.",
      badge: "a small grey pill; the default variant is filled with the accent.",
      tabs: "a rounded tray with a white raised cell for the active tab.",
      dialog: "a rounded panel with a hairline border and a deep soft shadow.",
    },
    icons: "Line icons at 18–20px, usually in the top corner of a tile inside a small rounded square (`size-9 rounded-xl bg-muted`).",
    dos: [
      "Vary tile sizes: one large, a few medium, several small.",
      "Give each tile one job — a number, a chart, a list, an action.",
      "Put a small grey label and a very large figure in the same tile.",
      "Fill one tile entirely with the accent to anchor the grid.",
    ],
    donts: [
      "Don't make every tile the same size, or lay out three equal cards in a row.",
      "Don't put tiles inside tiles more than one level deep.",
      "Don't use heavy shadows or thick borders on tiles.",
      "Don't leave a tile half-empty; size it to its content.",
    ],
  },
};
