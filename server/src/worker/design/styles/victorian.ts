import type { StyleSpec } from "../types";
import { SANS_FALLBACK, SERIF_FALLBACK, SYSTEM_MONO, variableFont } from "./fonts";

/**
 * Victorian: ornament, in the manner of a printed bill or a gilt frame. The
 * ornaments are rules and diamonds drawn in CSS and a lattice of fine lines
 * behind the page, so the look follows the accent and needs no picture: a
 * double rule round a panel, a small diamond under a title, a gold edge on a
 * button. The second colour, gold, is taken from the chart colours and used
 * only for the thin things.
 */
export const victorian: StyleSpec = {
  key: "victorian",
  name: "Victorian",
  look: "Ornate and old-fashioned: a high-contrast serif with a flourish of italic, double rules and small diamonds, deep wine and parchment, and a thread of gold.",
  suits:
    "Tea and chocolate merchants, a bookshop or a library, a theatre or a museum, a distillery, a hotel, a wedding, a period drama, a genealogy or history site, anything with a heritage or a story to tell with some ceremony.",
  avoid: "Not for software tools, dashboards or anything modern, fast or minimal.",
  group: "crafted",
  reach: "niche",
  aka: ["Victorian era", "Gothic ornate"],

  fonts: {
    display: variableFont("Bodoni Moda", "bodoni-moda", SERIF_FALLBACK, { italic: true }),
    body: variableFont("Lora", "lora", SERIF_FALLBACK, { italic: true }),
    mono: SYSTEM_MONO,
  },
  fontOptions: [
    {
      key: "playfair",
      label: "Playfair Display + Libre Franklin",
      fonts: {
        display: variableFont("Playfair Display", "playfair-display", SERIF_FALLBACK, { italic: true }),
        body: variableFont("Libre Franklin", "libre-franklin", SANS_FALLBACK),
        mono: SYSTEM_MONO,
      },
    },
    {
      key: "fraunces",
      label: "Fraunces + Source Serif 4",
      fonts: {
        display: variableFont("Fraunces", "fraunces", SERIF_FALLBACK, { italic: true }),
        body: variableFont("Source Serif 4", "source-serif-4", SERIF_FALLBACK, { italic: true }),
        mono: SYSTEM_MONO,
      },
    },
  ],
  defaultMode: "light",
  dials: { variance: 3, motion: 2, density: 5 },
  radius: "0",

  palette: {
    neutralHue: 82,
    // The second colour is gold, near the accent's neighbour on the wheel.
    chartHues: [70, -50, 150, 110],
    light: {
      background: { l: 0.94, c: 0.03 },
      surface: { l: 0.97, c: 0.02 },
      foreground: { l: 0.24, c: 0.04 },
      muted: { l: 0.91, c: 0.035 },
      mutedForeground: { l: 0.45, c: 0.04 },
      border: { l: 0.74, c: 0.055 },
      primary: { l: 0.4, c: 0.14 },
      wash: { l: 0.9, c: 0.045 },
    },
    dark: {
      background: { l: 0.2, c: 0.04 },
      surface: { l: 0.245, c: 0.045 },
      foreground: { l: 0.92, c: 0.03 },
      muted: { l: 0.285, c: 0.045 },
      mutedForeground: { l: 0.73, c: 0.04 },
      border: { l: 0.42, c: 0.06 },
      primary: { l: 0.74, c: 0.12 },
      wash: { l: 0.31, c: 0.06 },
    },
  },

  theme: {
    "--text-base": "1.0625rem",
    "--text-base--line-height": "1.7",
    "--shadow-2xs": "none",
    "--shadow-xs": "none",
    "--shadow-sm": "0 1px 0 0 color-mix(in oklab, var(--foreground) 14%, transparent)",
    "--shadow-md": "0 2px 0 0 color-mix(in oklab, var(--foreground) 16%, transparent)",
    "--shadow-lg": "0 12px 28px -14px color-mix(in oklab, var(--foreground) 36%, transparent)",
    "--shadow-xl": "0 24px 52px -24px color-mix(in oklab, var(--foreground) 44%, transparent)",
  },

  baseCss: `
  h1, h2, h3, h4 {
    font-family: var(--font-heading);
    font-weight: 500;
    letter-spacing: 0;
    line-height: 1.12;
    text-wrap: balance;
  }
  h1 { font-weight: 600; }
  h2 { font-variant: small-caps; letter-spacing: 0.04em; }
  p { text-wrap: pretty; }
  em, i { font-family: var(--font-heading); font-style: italic; }`,

  // A lattice of fine diagonal lines, as on printed paper, and a warm light from above.
  backdrop: `
      radial-gradient(60rem 28rem at 50% -6%, color-mix(in oklab, var(--primary) 9%, transparent), transparent 70%),
      repeating-linear-gradient(45deg, color-mix(in oklab, var(--foreground) 3.5%, transparent) 0 1px, transparent 1px 1.1rem),
      repeating-linear-gradient(-45deg, color-mix(in oklab, var(--foreground) 3.5%, transparent) 0 1px, transparent 1px 1.1rem)`,

  skin: {
    controlHeight: "2.75rem",
    controlPadX: "1.5rem",
    controlRadius: "0",
    controlText: "0.8125rem",
    borderWidth: "1px",
    buttonFont: "var(--font-heading)",
    buttonWeight: "600",
    buttonTracking: "0.14em",
    buttonCase: "uppercase",
    field: "outlined",
    fieldRadius: "0",
    fieldPadX: "0.875rem",
    cardRadius: "0",
    cardPad: "1.75rem",
    cardBorder: "3px double var(--border)",
    cardShadow: "var(--shadow-sm)",
    cardTitleSize: "1.5rem",
    cardTitleWeight: "500",
    cardTitleTracking: "0",
    badgeRadius: "0",
    badgeFont: "var(--font-heading)",
    badgeCase: "uppercase",
    badgeTracking: "0.14em",
    badgeWeight: "600",
    badgeText: "0.6875rem",
    badgePad: "0.1875rem 0.625rem",
    tabs: "underline",
    tabsRadius: "0",
    overlayRadius: "0",
    overlayBorder: "3px double var(--border)",
    overlayShadow: "var(--shadow-xl)",
    labelFont: "var(--font-heading)",
    labelCase: "uppercase",
    labelTracking: "0.12em",
    labelText: "0.75rem",
    labelWeight: "600",
    checkRadius: "0",
    iconStroke: "1.5",
    iconSize: "1.125rem",
  },

  skinCss: `
  /* The main button is wine with a thread of gold inside its edge. */
  [data-slot="button"][data-variant="default"] {
    box-shadow: inset 0 0 0 2px var(--primary), inset 0 0 0 3px color-mix(in oklab, var(--chart-2) 70%, var(--primary-foreground));
  }
  [data-slot="button"][data-variant="default"]:hover { background: color-mix(in oklab, var(--primary) 88%, var(--foreground)); }
  [data-slot="button"][data-variant="outline"] { background: transparent; border-color: var(--foreground); }
  [data-slot="button"][data-variant="outline"]:hover { background: var(--accent); }

  /* A panel has a double rule round it and a small diamond under its title. */
  [data-slot="card"] { position: relative; }
  [data-slot="card-title"] { font-family: var(--font-heading); }
  [data-slot="card-title"]::after {
    content: "";
    display: block;
    width: 0.5rem;
    height: 0.5rem;
    margin-top: 0.75rem;
    transform: rotate(45deg);
    background: color-mix(in oklab, var(--chart-2) 80%, var(--primary));
  }
  [data-slot="card-footer"] { background: transparent; border-top: 1px solid var(--border); }

  /* A badge is a small printed label, ruled top and bottom. */
  [data-slot="badge"] {
    background: transparent;
    border-width: 1px 0;
    border-style: solid;
    color: var(--muted-foreground);
  }
  [data-slot="badge"][data-variant="default"] { color: var(--primary); border-color: var(--primary); }

  [data-slot="separator"] { background: var(--border); }
  [data-slot="tabs-trigger"] { text-transform: uppercase; letter-spacing: 0.12em; font-size: 0.75rem; }`,

  layouts: [
    "editorial-column",
    "split-hero",
    "index-list",
    "full-bleed-bands",
    "poster",
    "focus-column",
    "master-detail",
    "topbar-workspace",
  ],

  prose: {
    overview:
      "This app has some ceremony. It is dressed like a good printed bill or a gilt-framed notice: a high-contrast serif, rules and small ornaments, deep wine on parchment, a thread of gold. It should feel old, careful and proud of itself — decorated, but never cluttered.",
    colors:
      "Parchment for the page, ivory for panels, a dark brown for text, and one deep accent — wine, bottle green, midnight blue — for the main action and the headings' small marks. Gold, the second colour, is for thin things only: a rule, a diamond, a hairline inside a button. Never as a fill or as text.",
    typography:
      "Headings in the high-contrast serif, regular to semibold, with the italic used for a flourish — one word in a heading. Subheadings in small capitals with a little letter spacing. Text in a book serif at a generous size and line height. Buttons and labels are small uppercase, widely spaced.",
    layout:
      "Symmetrical and centred, like a title page: a centred masthead, a ruled column, content set in the middle with generous margins. Separate sections with an ornamental rule, a thin double line with a small diamond in the middle. Headings may be framed.",
    elevation:
      "Flat, like print. A thin hard line under a panel. Only a dialog is lifted off the page, with a real shadow.",
    shapes:
      "Square corners everywhere. Panels have a triple rule — a double line — as a frame. Buttons are rectangles with a gold thread inside the edge. Nothing is rounded.",
    components: {
      button: "a square wine rectangle in small capitals, with a fine gold line inside its edge.",
      card: "an ivory panel framed by a double rule, with a serif title and a small gold diamond beneath it.",
      input: "a square field with a thin dark outline.",
      badge: "a small label in capitals, ruled above and below.",
      tabs: "small capitals with a rule under the active one.",
      dialog: "a framed ivory sheet with a double rule and a deep shadow.",
    },
    icons: "Fine line icons at 18px, rarely; prefer a word, or a small diamond, to an icon.",
    dos: [
      "Centre the masthead and give it a rule below, with a small diamond in the middle of it.",
      "Set a short line in small capitals above a heading to say what a section is.",
      "Use engravings, old maps, still lifes and portraits as images, in frames with a thin border.",
      "Write with some ceremony: full sentences, titles, the date and the place.",
    ],
    donts: [
      "Don't round any corner, or use gradients, glows or glass.",
      "Don't fill anything with gold or set text in it; gold is for hairlines.",
      "Don't use more than one accent besides the gold.",
      "Don't decorate everything: a rule and a diamond between sections is plenty.",
    ],
  },
};
