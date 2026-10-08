import type { StyleSpec } from "../types";
import { SANS_FALLBACK, SYSTEM_MONO, variableFont } from "./fonts";

/**
 * Conceptual sketch: a page from a designer's notebook. Ink on off-white,
 * lines that are not quite straight, a grid of faint squares behind it, one
 * flat wash of colour. The wobble is real CSS: a box whose eight corner radii
 * are all different has the uneven line of a hand-drawn rectangle. The
 * pictures are generated pen-and-ink drawings (`StyleSpec.art`).
 */

/** Corners of a box drawn by hand: eight radii, no two alike. */
const HAND_BOX = "255px 12px 225px 14px / 14px 225px 12px 255px";
const HAND_BOX_SMALL = "28px 6px 24px 7px / 7px 24px 6px 28px";

export const sketch: StyleSpec = {
  key: "sketch",
  name: "Conceptual sketch",
  look: "A page from a designer's notebook: ink on off-white graph paper, boxes drawn by hand with lines that are not quite straight, a monospaced hand for the lettering, one flat wash of colour, and pen-and-ink drawings.",
  suits:
    "Designers', architects' and illustrators' portfolios, a studio, a research or a thinking-out-loud page, a product still in concept, an idea or a process, a newsletter or a course, a workshop, anything meant to look worked out by hand.",
  avoid: "Not for finance, shops that must feel dependable, or anything that has to look finished, polished or corporate.",
  group: "crafted",
  reach: "niche",
  aka: ["Sketchbook", "Pen and ink"],
  art: "A loose conceptual pen-and-ink sketch on off-white paper: confident black linework with a little cross-hatching, construction lines still showing, one flat wash of a single colour, unfinished edges, like a page from a designer's notebook",

  fonts: {
    display: variableFont("Chivo Mono", "chivo-mono", SANS_FALLBACK),
    body: variableFont("Karla", "karla", SANS_FALLBACK),
    mono: SYSTEM_MONO,
  },
  fontOptions: [
    {
      key: "martian",
      label: "Martian Mono + Work Sans",
      fonts: {
        display: variableFont("Martian Mono", "martian-mono", SANS_FALLBACK),
        body: variableFont("Work Sans", "work-sans", SANS_FALLBACK),
        mono: SYSTEM_MONO,
      },
    },
    {
      key: "fira",
      label: "Fira Code + Public Sans",
      fonts: {
        display: variableFont("Fira Code", "fira-code", SANS_FALLBACK),
        body: variableFont("Public Sans", "public-sans", SANS_FALLBACK),
        mono: SYSTEM_MONO,
      },
    },
  ],
  defaultMode: "light",
  dials: { variance: 7, motion: 3, density: 4 },
  radius: "0.5rem",

  palette: {
    neutralHue: 95,
    chartHues: [60, -60, 120, 190],
    light: {
      background: { l: 0.965, c: 0.012 },
      surface: { l: 0.985, c: 0.008 },
      foreground: { l: 0.22, c: 0.015 },
      muted: { l: 0.93, c: 0.014 },
      mutedForeground: { l: 0.46, c: 0.016 },
      border: { l: 0.22, c: 0.015 },
      primary: { l: 0.56, c: 0.16 },
      wash: { l: 0.92, c: 0.05 },
    },
    dark: {
      background: { l: 0.21, c: 0.012 },
      surface: { l: 0.255, c: 0.012 },
      foreground: { l: 0.94, c: 0.012 },
      muted: { l: 0.29, c: 0.014 },
      mutedForeground: { l: 0.75, c: 0.016 },
      border: { l: 0.88, c: 0.012 },
      primary: { l: 0.76, c: 0.14 },
      wash: { l: 0.33, c: 0.05 },
    },
  },

  theme: {
    "--text-base": "1rem",
    "--text-base--line-height": "1.65",
    "--shadow-2xs": "none",
    "--shadow-xs": "none",
    "--shadow-sm": "2px 2px 0 0 color-mix(in oklab, var(--foreground) 80%, transparent)",
    "--shadow-md": "3px 4px 0 0 color-mix(in oklab, var(--foreground) 80%, transparent)",
    "--shadow-lg": "5px 6px 0 0 color-mix(in oklab, var(--foreground) 80%, transparent)",
    "--shadow-xl": "8px 9px 0 0 color-mix(in oklab, var(--foreground) 80%, transparent)",
  },

  baseCss: `
  h1, h2, h3, h4 {
    font-family: var(--font-heading);
    font-weight: 500;
    letter-spacing: -0.03em;
    line-height: 1.12;
    text-wrap: balance;
  }
  h1 { font-weight: 600; }
  p { text-wrap: pretty; }
  /* A note in the margin: small, mono, a little off the line. */
  small, .note { font-family: var(--font-mono); font-size: 0.8125rem; }`,

  // Graph paper: a faint grid of small squares, a heavier one every fifth line, and a margin rule.
  backdrop: `
      linear-gradient(90deg, color-mix(in oklab, var(--primary) 30%, transparent) 0 1px, transparent 1px) 4.5rem 0 / 100% 100% no-repeat,
      linear-gradient(color-mix(in oklab, var(--foreground) 7%, transparent) 1px, transparent 1px) 0 0 / 1.25rem 1.25rem,
      linear-gradient(90deg, color-mix(in oklab, var(--foreground) 7%, transparent) 1px, transparent 1px) 0 0 / 1.25rem 1.25rem`,

  skin: {
    controlHeight: "2.75rem",
    controlPadX: "1.25rem",
    controlRadius: HAND_BOX_SMALL,
    controlText: "0.875rem",
    borderWidth: "2px",
    buttonFont: "var(--font-heading)",
    buttonWeight: "500",
    buttonTracking: "-0.01em",
    buttonCase: "none",
    field: "underline",
    fieldRadius: "0",
    fieldPadX: "0.25rem",
    cardRadius: HAND_BOX,
    cardPad: "1.75rem",
    cardBorder: "2px solid var(--border)",
    cardShadow: "var(--shadow-md)",
    cardTitleSize: "1.25rem",
    cardTitleWeight: "600",
    cardTitleTracking: "-0.02em",
    badgeRadius: HAND_BOX_SMALL,
    badgeFont: "var(--font-heading)",
    badgeCase: "none",
    badgeTracking: "0",
    badgeWeight: "500",
    badgeText: "0.75rem",
    badgePad: "0.1875rem 0.625rem",
    tabs: "underline",
    tabsRadius: "0",
    overlayRadius: HAND_BOX,
    overlayBorder: "2px solid var(--border)",
    overlayShadow: "var(--shadow-xl)",
    labelFont: "var(--font-heading)",
    labelCase: "none",
    labelTracking: "-0.01em",
    labelText: "0.8125rem",
    labelWeight: "500",
    checkRadius: "0.125rem",
    iconStroke: "1.5",
    iconSize: "1.125rem",
  },

  skinCss: `
  [data-slot="button"] { transition: transform 120ms ease, box-shadow 120ms ease; }
  [data-slot="button"][data-variant="default"] { box-shadow: 2px 3px 0 0 var(--foreground); }
  [data-slot="button"][data-variant="default"]:hover { transform: translate(-1px, -1px) rotate(-0.6deg); }
  [data-slot="button"][data-variant="default"]:active { transform: translate(2px, 3px); box-shadow: none; }
  [data-slot="button"][data-variant="outline"] { background: transparent; border-color: var(--foreground); }
  [data-slot="button"][data-variant="outline"]:hover { background: var(--accent); }

  /* Boxes are drawn, so each is a little different from the next. */
  [data-slot="card"]:nth-of-type(even) { border-radius: 14px 240px 12px 230px / 230px 12px 250px 14px; }
  [data-slot="card-title"] { font-family: var(--font-heading); }
  [data-slot="card-footer"] { background: transparent; border-top: 2px dashed var(--border); }

  /* The field is a ruled line, as on a form filled in with a pen. */
  [data-slot="input"], [data-slot="textarea"], [data-slot="select-trigger"] { border-bottom-style: solid; }

  /* A badge is a word circled. */
  [data-slot="badge"] { background: transparent; border: 1.5px solid var(--foreground); color: var(--foreground); }
  [data-slot="badge"][data-variant="default"] { background: var(--accent); color: var(--accent-foreground); }
  [data-slot="separator"] { background: var(--foreground); height: 2px; opacity: 0.8; }`,

  layouts: [
    "editorial-column",
    "split-hero",
    "index-list",
    "bento",
    "poster",
    "split-tool",
    "focus-column",
    "topbar-workspace",
  ],

  prose: {
    overview:
      "This app is a page from a designer's notebook, still being worked out. Ink on graph paper, boxes drawn by hand, lettering in a plain monospaced hand, one flat splash of colour where something matters, and pen-and-ink drawings that are not finished. It should feel thought-through and a bit unpolished on purpose.",
    colors:
      "Off-white paper, near-black ink for text and every line, and one accent used as a flat wash — a highlighter swipe — on the main thing, never as a gradient. A faint grid of squares and a pale margin rule sit behind the page.",
    typography:
      "Headings and labels in the monospaced face, tight, sentence case, medium weight. Text in a plain, friendly sans. Small notes — a date, a caption, an aside — in the mono at a small size, like a margin comment. No italics for emphasis; underline or circle instead.",
    layout:
      "Lay it out like a sketchbook spread: a column of text with a drawing beside it, annotations pointing at things, boxes of different sizes with room between them. Let a drawing break out of its box. Number things. Keep a margin.",
    elevation:
      "Flat ink: a solid offset line under a box, as a pen would double it, never a blur. Only a dialog gets a heavy one.",
    shapes:
      "Everything is drawn by hand: boxes whose corners are all slightly different, so no two are the same and none is a clean rectangle. Lines are 2px and black. Buttons are small hand-drawn rectangles.",
    components: {
      button: "a hand-drawn rectangle in ink with a doubled line under it that it presses flat into.",
      card: "a box drawn in two-pixel ink with uneven corners and a doubled line beneath, with a mono title.",
      input: "a ruled line to write on.",
      badge: "a word circled in ink.",
      tabs: "plain words in the mono with a line under the active one.",
      dialog: "a big hand-drawn box with a heavy doubled line.",
    },
    icons: "Line icons at 18px that look drawn, beside a word, or a simple arrow in ink.",
    dos: [
      "Make the artwork with `generate_image`: loose pen-and-ink drawings with one wash of colour, and annotate them in text beside, not in the picture.",
      "Number the sections and steps, and point at things with arrows drawn in CSS or SVG.",
      "Show the working: a rough version, an alternative, a crossed-out idea.",
      "Write the way someone thinks aloud on paper.",
    ],
    donts: [
      "Don't make anything look polished: no gradients, no glass, no soft shadows.",
      "Don't use more than one colour besides ink and paper.",
      "Don't use perfectly even rounded corners.",
      "Don't generate text in a picture; write it in the page.",
    ],
  },
};
