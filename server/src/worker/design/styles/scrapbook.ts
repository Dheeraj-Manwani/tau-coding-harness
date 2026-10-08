import type { StyleSpec } from "../types";
import { SANS_FALLBACK, SYSTEM_MONO, variableFont } from "./fonts";

/**
 * A scrapbook page: paper stuck down with tape, a hand-lettered heading, a
 * sticker. None of the paper is a picture. The grain and the dots are an SVG
 * and a gradient in the stylesheet, the tape is a pseudo-element, and the
 * slight tilt of a card is a transform, so the look follows the accent and
 * both modes, and needs no file shipped with the app.
 */

/** Paper grain: noise, as a tiled SVG. Brown, so it reads as fibre on a light page and as dust on a dark one. */
const GRAIN = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 .36 0 0 0 0 .28 0 0 0 0 .2 0 0 0 .55 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.3'/%3E%3C/svg%3E")`;

export const scrapbook: StyleSpec = {
  key: "scrapbook",
  name: "Scrapbook",
  look: "Paper stuck down by hand: a hand-lettered heading, cards that sit slightly crooked under a strip of tape, stamped labels and dotted notebook paper behind it all.",
  suits:
    "Journals and diaries, recipe books, hobby and craft sites, travel logs, wedding and baby pages, a personal homepage, a small shop with a story, anything meant to feel kept and loved.",
  avoid: "Not for dashboards, finance, admin tools or anything that must feel exact, fast or corporate.",
  group: "tactile",
  reach: "niche",
  aka: ["Collage", "Paper craft"],

  fonts: {
    display: variableFont("Grandstander", "grandstander", SANS_FALLBACK),
    body: variableFont("Mulish", "mulish", SANS_FALLBACK),
    mono: SYSTEM_MONO,
  },
  fontOptions: [
    {
      key: "baloo",
      label: "Baloo 2 + Nunito Sans",
      fonts: {
        display: variableFont("Baloo 2", "baloo-2", SANS_FALLBACK),
        body: variableFont("Nunito Sans", "nunito-sans", SANS_FALLBACK),
        mono: SYSTEM_MONO,
      },
    },
    {
      key: "dynapuff",
      label: "DynaPuff + Karla",
      fonts: {
        display: variableFont("DynaPuff", "dynapuff", SANS_FALLBACK),
        body: variableFont("Karla", "karla", SANS_FALLBACK),
        mono: SYSTEM_MONO,
      },
    },
  ],
  defaultMode: "light",
  dials: { variance: 8, motion: 4, density: 5 },
  radius: "0.25rem",

  palette: {
    neutralHue: 75,
    chartHues: [55, -55, 120, 190],
    light: {
      background: { l: 0.95, c: 0.03 },
      surface: { l: 0.985, c: 0.014 },
      foreground: { l: 0.25, c: 0.025 },
      muted: { l: 0.91, c: 0.04 },
      mutedForeground: { l: 0.46, c: 0.035 },
      border: { l: 0.76, c: 0.045 },
      primary: { l: 0.55, c: 0.17 },
      wash: { l: 0.91, c: 0.06 },
    },
    dark: {
      background: { l: 0.23, c: 0.022 },
      surface: { l: 0.285, c: 0.025 },
      foreground: { l: 0.94, c: 0.02 },
      muted: { l: 0.32, c: 0.03 },
      mutedForeground: { l: 0.74, c: 0.03 },
      border: { l: 0.44, c: 0.035 },
      primary: { l: 0.76, c: 0.14 },
      wash: { l: 0.34, c: 0.05 },
    },
  },

  theme: {
    "--text-base": "1.0625rem",
    "--text-base--line-height": "1.65",
    "--shadow-2xs": "none",
    "--shadow-xs": "1px 1px 0 0 color-mix(in oklab, var(--foreground) 18%, transparent)",
    "--shadow-sm": "2px 3px 0 0 color-mix(in oklab, var(--foreground) 16%, transparent)",
    "--shadow-md": "3px 5px 0 0 color-mix(in oklab, var(--foreground) 14%, transparent)",
    "--shadow-lg": "4px 8px 14px -6px color-mix(in oklab, var(--foreground) 30%, transparent)",
    "--shadow-xl": "6px 14px 28px -10px color-mix(in oklab, var(--foreground) 38%, transparent)",
  },

  baseCss: `
  h1, h2, h3, h4 {
    font-family: var(--font-heading);
    font-weight: 600;
    letter-spacing: 0;
    line-height: 1.12;
    text-wrap: balance;
  }
  p { text-wrap: pretty; }
  /* A heading underlined the way a pen would, not with a rule. */
  h1 { text-decoration: underline wavy color-mix(in oklab, var(--primary) 60%, transparent) 2px; text-underline-offset: 0.18em; }`,

  // Notebook dots and paper grain, painted behind everything.
  backdrop: `
      ${GRAIN},
      radial-gradient(color-mix(in oklab, var(--foreground) 16%, transparent) 1px, transparent 1.5px) 0 0 / 1.5rem 1.5rem`,

  skin: {
    controlHeight: "2.75rem",
    controlPadX: "1.25rem",
    controlRadius: "0.25rem",
    controlText: "1rem",
    borderWidth: "2px",
    buttonFont: "var(--font-heading)",
    buttonWeight: "600",
    buttonTracking: "0.01em",
    buttonCase: "none",
    field: "underline",
    fieldRadius: "0",
    fieldPadX: "0.25rem",
    cardRadius: "0.125rem",
    cardPad: "1.5rem",
    cardBorder: "1px solid var(--border)",
    cardShadow: "var(--shadow-md)",
    cardTitleSize: "1.375rem",
    cardTitleWeight: "600",
    cardTitleTracking: "0",
    badgeRadius: "0.125rem",
    badgeFont: "var(--font-sans)",
    badgeCase: "uppercase",
    badgeTracking: "0.12em",
    badgeWeight: "800",
    badgeText: "0.6875rem",
    badgePad: "0.25rem 0.625rem",
    tabs: "segmented",
    tabsRadius: "0.25rem",
    overlayRadius: "0.125rem",
    overlayBorder: "1px solid var(--border)",
    overlayShadow: "var(--shadow-xl)",
    labelFont: "var(--font-heading)",
    labelCase: "none",
    labelTracking: "0",
    labelText: "0.9375rem",
    labelWeight: "600",
    checkRadius: "0.125rem",
    iconStroke: "2",
    iconSize: "1.25rem",
  },

  skinCss: `
  /* A button is an inked stamp: a hard edge beneath that it presses into. */
  [data-slot="button"] { transition: transform 120ms ease, box-shadow 120ms ease; }
  [data-slot="button"][data-variant="default"] { box-shadow: 2px 3px 0 0 var(--foreground); }
  [data-slot="button"][data-variant="default"]:hover { transform: rotate(-1deg) translateY(-1px); }
  [data-slot="button"][data-variant="default"]:active { transform: translate(2px, 3px); box-shadow: none; }
  [data-slot="button"][data-variant="outline"] { background: var(--card); border-style: dashed; border-color: var(--foreground); }
  [data-slot="button"][data-variant="secondary"] { background: var(--accent); color: var(--accent-foreground); }

  /* A card is a scrap of paper stuck down by a strip of tape, a little crooked.
     Alternate scraps lean the other way, so a row of them is not a row. */
  [data-slot="card"] {
    position: relative;
    overflow: visible;
    background-image: ${GRAIN};
    transform: rotate(-0.5deg);
  }
  [data-slot="card"]:nth-of-type(even) { transform: rotate(0.6deg); }
  [data-slot="card"]:nth-of-type(3n) { transform: rotate(-0.25deg); }
  [data-slot="card"]::before {
    content: "";
    position: absolute;
    top: -0.7rem;
    left: 50%;
    width: 4.75rem;
    height: 1.4rem;
    transform: translateX(-50%) rotate(-2deg);
    background: color-mix(in oklab, var(--chart-2) 38%, transparent);
    box-shadow: 0 1px 0 0 color-mix(in oklab, var(--foreground) 10%, transparent);
    pointer-events: none;
  }
  [data-slot="card"]:nth-of-type(even)::before { transform: translateX(-50%) rotate(2.5deg); background: color-mix(in oklab, var(--chart-3) 38%, transparent); }
  [data-slot="card-title"] { font-family: var(--font-heading); }
  [data-slot="card-footer"] { background: transparent; border-top: 1px dashed var(--border); }

  /* Fields are a line to write on. */
  [data-slot="input"], [data-slot="textarea"], [data-slot="select-trigger"] { border-bottom-style: dashed; }

  /* Badges are label-maker strips. */
  [data-slot="badge"] { transform: rotate(-1.5deg); border: 1px solid color-mix(in oklab, currentColor 40%, transparent); }
  [data-slot="badge"][data-variant="default"] { background: var(--primary); color: var(--primary-foreground); }

  /* A dialog is a sheet laid on top of the page, with its own tape. */
  [data-slot="dialog-content"], [data-slot="alert-dialog-content"] { background-image: ${GRAIN}; }

  /* Tilted paper must not make a page scroll sideways. */
  body { overflow-x: clip; }`,

  layouts: [
    "split-hero",
    "editorial-column",
    "bento",
    "poster",
    "index-list",
    "focus-column",
    "topbar-workspace",
  ],

  prose: {
    overview:
      "This app looks kept, like a scrapbook someone has been filling in: scraps of paper stuck to a dotted page with tape, a heading in someone's handwriting, small stamped labels. It should feel personal and a little untidy on purpose, never messy to use.",
    colors:
      "A cream page and cream paper, dark ink for text and one bright accent used like a sticker or a highlighter: on the main button, on a stamp, on a sticker. The tape is a pale wash of the chart colours. Nothing is pure white or pure black.",
    typography:
      "Headings in the hand-lettered face at a good size, mixed case, sometimes tilted a degree or two. Text in a plain friendly sans. Small uppercase stamps for labels and dates only. A handwritten note can be a line of the heading face in the accent colour.",
    layout:
      "Compose like a page being made: some things big, some small, some overlapping a corner of another. Let images sit at an angle in a white border like a print. Leave room around everything so the page can breathe between scraps.",
    elevation:
      "Paper lies on paper: a hard offset shadow, two or three pixels down and to the right, never a soft blur. Only a dialog lifts off the page with a real shadow.",
    shapes:
      "Corners are nearly square, like cut paper. Cards are tilted by about half a degree, and by different amounts, and carry a strip of tape. Buttons are small stamped rectangles with a dashed outline for the quiet kind. Fields are a line to write on.",
    components: {
      button: "a stamped rectangle with a hard shadow that it presses flat into; the quiet kind has a dashed outline.",
      card: "a scrap of paper with a thin edge, a hard shadow and a strip of tape across the top, tilted a little.",
      input: "a dashed line to write on, with no box.",
      badge: "a small uppercase label strip, tilted slightly, like one from a label maker.",
      tabs: "a tray of small paper tabs, the active one on top.",
      dialog: "a sheet of paper laid over the page, with a deep shadow.",
    },
    icons: "Chunky line icons at 20–24px, drawn like doodles beside a word; a sticker is an icon in a coloured circle.",
    dos: [
      "Use real photographs as prints: a white border, a slight tilt, a caption in the heading face.",
      "Put one handwritten note, in the heading face and the accent colour, on each page.",
      "Let a scrap overlap another, or hang off the edge of its column by a few pixels.",
      "Write in the first person, the way someone talks in their own notebook.",
    ],
    donts: [
      "Don't tilt text itself by more than a degree or two, and never tilt a form or a table.",
      "Don't use soft blurred shadows, gradients or glass.",
      "Don't draw the paper as a picture or add texture images: the grain and the tape are already in the stylesheet.",
      "Don't use it for anything that has to be read quickly or compared in columns.",
    ],
  },
};
