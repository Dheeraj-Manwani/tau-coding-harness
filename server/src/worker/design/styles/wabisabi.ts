import type { StyleSpec } from "../types";
import { SANS_FALLBACK, SERIF_FALLBACK, SYSTEM_MONO, variableFont } from "./fonts";

/**
 * Wabi-sabi: beauty in the imperfect, the plain and the quiet. The look is made
 * of what is left out: no hard edges, no strong colour, nothing perfectly
 * symmetrical. The corners of every shape are a little different from one
 * another, the page has the faint grain of handmade paper, and one soft
 * blotch of colour sits on it like a stain of tea.
 */

/** Handmade paper: a fine, uneven noise, tiled. */
const FIBRE = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.55 .9' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 .4 0 0 0 0 .34 0 0 0 0 .26 0 0 0 .5 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.22'/%3E%3C/svg%3E")`;

export const wabisabi: StyleSpec = {
  key: "wabisabi",
  name: "Wabi-sabi",
  look: "Quiet and imperfect: muted earth tones, a soft serif, generous empty space, shapes whose corners are each slightly different, and the faint grain of handmade paper.",
  suits:
    "Ceramics, tea, slow living and wellbeing, a craftsperson's or an artist's portfolio, a studio, a retreat, interiors, a small press, anything that wants to feel calm, natural and unhurried.",
  avoid: "Not for anything urgent, dense or loud: dashboards, trading, games, sales pages with countdowns.",
  group: "tactile",
  reach: "niche",
  aka: ["Wabi sabi", "Imperfect minimalism"],

  fonts: {
    display: variableFont("Newsreader", "newsreader", SERIF_FALLBACK, { italic: true }),
    body: variableFont("Hanken Grotesk", "hanken-grotesk", SANS_FALLBACK),
    mono: SYSTEM_MONO,
  },
  fontOptions: [
    {
      key: "cormorant",
      label: "Cormorant + Karla",
      fonts: {
        display: variableFont("Cormorant", "cormorant", SERIF_FALLBACK, { italic: true }),
        body: variableFont("Karla", "karla", SANS_FALLBACK),
        mono: SYSTEM_MONO,
      },
    },
    {
      key: "vollkorn",
      label: "Vollkorn + Albert Sans",
      fonts: {
        display: variableFont("Vollkorn", "vollkorn", SERIF_FALLBACK, { italic: true }),
        body: variableFont("Albert Sans", "albert-sans", SANS_FALLBACK),
        mono: SYSTEM_MONO,
      },
    },
  ],
  defaultMode: "light",
  dials: { variance: 3, motion: 2, density: 2 },
  radius: "0.5rem",

  palette: {
    neutralHue: 85,
    chartHues: [25, 55, -35, 95],
    // Earth tones: the chart colours are clay, moss and ash, none of them bright.
    chartLightness: {
      light: [0.6, 0.52, 0.7, 0.44],
      dark: [0.7, 0.62, 0.78, 0.55],
    },
    light: {
      background: { l: 0.945, c: 0.016 },
      surface: { l: 0.965, c: 0.013 },
      foreground: { l: 0.3, c: 0.02 },
      muted: { l: 0.915, c: 0.02 },
      mutedForeground: { l: 0.5, c: 0.022 },
      border: { l: 0.86, c: 0.022 },
      primary: { l: 0.5, c: 0.075 },
      wash: { l: 0.92, c: 0.028 },
    },
    dark: {
      background: { l: 0.23, c: 0.012 },
      surface: { l: 0.265, c: 0.013 },
      foreground: { l: 0.9, c: 0.015 },
      muted: { l: 0.3, c: 0.015 },
      mutedForeground: { l: 0.7, c: 0.018 },
      border: { l: 0.37, c: 0.016 },
      primary: { l: 0.72, c: 0.075 },
      wash: { l: 0.32, c: 0.026 },
    },
  },

  theme: {
    "--text-base": "1.0625rem",
    "--text-base--line-height": "1.75",
    "--shadow-2xs": "none",
    "--shadow-xs": "none",
    "--shadow-sm": "0 1px 2px 0 color-mix(in oklab, var(--foreground) 8%, transparent)",
    "--shadow-md": "0 6px 18px -10px color-mix(in oklab, var(--foreground) 22%, transparent)",
    "--shadow-lg": "0 14px 34px -18px color-mix(in oklab, var(--foreground) 28%, transparent)",
    "--shadow-xl": "0 26px 56px -28px color-mix(in oklab, var(--foreground) 34%, transparent)",
  },

  baseCss: `
  h1, h2, h3, h4 {
    font-family: var(--font-heading);
    font-weight: 400;
    letter-spacing: -0.005em;
    line-height: 1.2;
    text-wrap: balance;
  }
  h1 { font-weight: 300; }
  p { text-wrap: pretty; max-width: 68ch; }
  em, i { font-family: var(--font-heading); }`,

  // A grain, and one soft stain of the accent off to one side of the page.
  backdrop: `
      ${FIBRE},
      radial-gradient(46rem 30rem at 82% 8%, color-mix(in oklab, var(--primary) 9%, transparent), transparent 70%),
      radial-gradient(34rem 26rem at 4% 92%, color-mix(in oklab, var(--chart-2) 8%, transparent), transparent 70%)`,

  skin: {
    controlHeight: "2.75rem",
    controlPadX: "1.5rem",
    // Each corner a little different, as if shaped by hand.
    controlRadius: "0.625rem 0.5rem 0.75rem 0.5rem",
    controlText: "0.9375rem",
    borderWidth: "1px",
    buttonFont: "var(--font-sans)",
    buttonWeight: "500",
    buttonTracking: "0.02em",
    buttonCase: "none",
    field: "filled",
    fieldRadius: "0.5rem 0.625rem 0.5rem 0.75rem",
    fieldPadX: "1rem",
    cardRadius: "0.875rem 0.625rem 1rem 0.5rem",
    cardPad: "2rem",
    cardBorder: "1px solid color-mix(in oklab, var(--border) 80%, transparent)",
    cardShadow: "var(--shadow-sm)",
    cardTitleSize: "1.375rem",
    cardTitleWeight: "400",
    cardTitleTracking: "-0.005em",
    badgeRadius: "0.5rem 0.375rem 0.5rem 0.625rem",
    badgeFont: "var(--font-sans)",
    badgeCase: "none",
    badgeTracking: "0.02em",
    badgeWeight: "500",
    badgeText: "0.75rem",
    badgePad: "0.25rem 0.75rem",
    tabs: "underline",
    tabsRadius: "0",
    overlayRadius: "1rem 0.75rem 1.125rem 0.625rem",
    overlayBorder: "1px solid color-mix(in oklab, var(--border) 80%, transparent)",
    overlayShadow: "var(--shadow-xl)",
    labelFont: "var(--font-sans)",
    labelCase: "none",
    labelTracking: "0.02em",
    labelText: "0.875rem",
    labelWeight: "500",
    checkRadius: "0.375rem",
    iconStroke: "1.25",
    iconSize: "1.125rem",
  },

  skinCss: `
  [data-slot="button"] { transition: background-color 200ms ease, border-color 200ms ease, color 200ms ease; }
  [data-slot="button"][data-variant="default"] { box-shadow: none; }
  [data-slot="button"][data-variant="default"]:hover { background: color-mix(in oklab, var(--primary) 86%, var(--foreground)); }
  [data-slot="button"][data-variant="outline"] { background: transparent; border-color: color-mix(in oklab, var(--foreground) 35%, transparent); }
  [data-slot="button"][data-variant="outline"]:hover { background: var(--accent); }
  [data-slot="button"][data-variant="ghost"]:hover { background: var(--accent); }

  /* Panels are paper, with the page's grain in them and an edge that is barely there. */
  [data-slot="card"] { background-image: ${FIBRE}; }
  [data-slot="card-title"] { font-family: var(--font-heading); }
  [data-slot="card-footer"] { background: transparent; border-top: 1px solid color-mix(in oklab, var(--border) 70%, transparent); }

  /* A badge is a word with a little ground under it, not a label. */
  [data-slot="badge"] { background: var(--muted); color: var(--muted-foreground); border: 0; }
  [data-slot="badge"][data-variant="default"] { background: color-mix(in oklab, var(--primary) 14%, var(--card)); color: color-mix(in oklab, var(--primary) 78%, var(--foreground)); }

  [data-slot="dialog-content"], [data-slot="alert-dialog-content"] { background-image: ${FIBRE}; }
  [data-slot="separator"] { background: color-mix(in oklab, var(--border) 80%, transparent); }`,

  layouts: [
    "editorial-column",
    "split-hero",
    "full-bleed-bands",
    "poster",
    "index-list",
    "focus-column",
    "topbar-workspace",
  ],

  prose: {
    overview:
      "This app is quiet. It is made of space and a few muted, natural things, and it does not hurry anyone. Nothing in it is perfectly aligned or perfectly even, and nothing shouts. It should feel like a room with one good object in it.",
    colors:
      "Muted earth tones: bone, linen and clay for the page and its panels, a soft charcoal brown for text, and one low-key accent — moss, clay, indigo, ash — used sparingly, on the main action and a few small marks. No saturated colour, no pure white, no pure black.",
    typography:
      "Headings in the soft serif at light or regular weight, never bold, in sentence case, set generously large with plenty of space around them. Text in a quiet sans at a comfortable size and a generous line height. Let the italic carry a word of feeling. No uppercase except a rare tiny label.",
    layout:
      "Use less than seems right. Wide margins, one idea to a screen, long pauses of empty space. Put things off-centre, and let a column be narrower than the page. Prefer one good photograph, large, to several small ones.",
    elevation:
      "Almost flat. A panel is separated from the page by a hairline and the barest shadow, as paper on a table. Only a dialog is lifted, and softly.",
    shapes:
      "Soft corners, each of a different size on the same shape, so nothing is a perfect rounded rectangle: 8 to 16px. Edges are one-pixel, pale and a little transparent. Dividers are hairlines.",
    components: {
      button: "a softly irregular shape, filled in the accent for the main action and otherwise a faint outline; it changes colour slowly.",
      card: "a panel of paper with uneven corners, a hairline edge and generous padding.",
      input: "a soft filled field with uneven corners and no outline until it is focused.",
      badge: "a small word on a pale ground, in sentence case.",
      tabs: "plain words with a thin rule under the active one.",
      dialog: "a sheet with uneven corners and a soft, deep shadow.",
    },
    icons: "Thin line icons at 18px, used rarely and always beside a word.",
    dos: [
      "Leave out whatever the screen can do without, then leave out one more thing.",
      "Use photographs of real, worn, handmade things, in natural light.",
      "Write short, plain, unhurried sentences that say one thing.",
      "Let a section end with empty space instead of a rule.",
    ],
    donts: [
      "Don't use bright colours, gradients, glows or glass.",
      "Don't use bold weights, uppercase headings or tight spacing.",
      "Don't make every shape the same; don't align everything to a rigid grid.",
      "Don't add animation beyond a slow fade.",
    ],
  },
};
