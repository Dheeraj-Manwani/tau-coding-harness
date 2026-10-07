import type { StyleSpec } from "../types";
import { SANS_FALLBACK, SERIF_FALLBACK, SYSTEM_MONO, variableFont } from "./fonts";
import { TABS_TAB } from "./selectors";

export const luxe: StyleSpec = {
  key: "luxe",
  name: "Luxe",
  look: "Quiet luxury after dark: a fine high-contrast serif, a deep near-black page, one muted metallic accent, a great deal of empty space.",
  suits:
    "Premium and boutique brands, fashion, jewellery, fine dining, hotels, weddings and events, galleries, private services.",
  avoid: "Not for utilities and dashboards, or for anything cheap and cheerful.",
  group: "crafted",
  reach: "niche",
  aka: ["Luxury typography", "Quiet luxury"],

  fonts: {
    display: variableFont("Cormorant", "cormorant", SERIF_FALLBACK, { italic: true }),
    body: variableFont("Jost", "jost", SANS_FALLBACK),
    mono: SYSTEM_MONO,
  },
  fontOptions: [
    {
      key: "playfair",
      label: "Playfair Display + Raleway",
      fonts: {
        display: variableFont("Playfair Display", "playfair-display", SERIF_FALLBACK, { italic: true }),
        body: variableFont("Raleway", "raleway", SANS_FALLBACK),
        mono: SYSTEM_MONO,
      },
    },
    {
      key: "bodoni",
      label: "Bodoni Moda + Montserrat",
      fonts: {
        display: variableFont("Bodoni Moda", "bodoni-moda", SERIF_FALLBACK, { italic: true }),
        body: variableFont("Montserrat", "montserrat", SANS_FALLBACK),
        mono: SYSTEM_MONO,
      },
    },
  ],
  defaultMode: "dark",
  dials: { variance: 7, motion: 5, density: 2 },
  radius: "0rem",

  palette: {
    neutralHue: "accent",
    chartHues: [20, -20, 40, -40],
    light: {
      background: { l: 0.972, c: 0.006 },
      surface: { l: 0.99, c: 0.004 },
      foreground: { l: 0.2, c: 0.01 },
      muted: { l: 0.945, c: 0.008 },
      mutedForeground: { l: 0.48, c: 0.012 },
      border: { l: 0.86, c: 0.01 },
      primary: { l: 0.45, c: 0.08 },
      wash: { l: 0.93, c: 0.02 },
    },
    dark: {
      background: { l: 0.13, c: 0.006 },
      surface: { l: 0.16, c: 0.008 },
      foreground: { l: 0.93, c: 0.012 },
      muted: { l: 0.2, c: 0.008 },
      mutedForeground: { l: 0.68, c: 0.015 },
      border: { l: 0.28, c: 0.012 },
      primary: { l: 0.79, c: 0.09 },
      wash: { l: 0.22, c: 0.02 },
    },
  },

  theme: {
    "--text-base": "1rem",
    "--text-base--line-height": "1.8",
    "--shadow-2xs": "none",
    "--shadow-xs": "none",
    "--shadow-sm": "none",
    "--shadow-md": "none",
    "--shadow-lg": "0 30px 80px -40px rgb(0 0 0 / 0.7)",
    "--shadow-xl": "0 40px 100px -40px rgb(0 0 0 / 0.8)",
  },

  baseCss: `
  h1, h2, h3, h4 {
    font-family: var(--font-heading);
    font-weight: 400;
    letter-spacing: -0.01em;
    line-height: 1.05;
    text-wrap: balance;
  }
  body { font-weight: 300; letter-spacing: 0.01em; }
  em, i { font-family: var(--font-heading); }`,

  skin: {
    controlHeight: "3rem",
    controlPadX: "2rem",
    controlRadius: "0",
    controlText: "0.6875rem",
    borderWidth: "1px",
    buttonFont: "var(--font-sans)",
    buttonWeight: "400",
    buttonTracking: "0.22em",
    buttonCase: "uppercase",
    field: "underline",
    fieldRadius: "0",
    fieldPadX: "0",
    cardRadius: "0",
    cardPad: "2rem",
    cardBorder: "1px solid var(--border)",
    cardShadow: "none",
    cardTitleSize: "1.75rem",
    cardTitleWeight: "400",
    cardTitleTracking: "0",
    badgeRadius: "0",
    badgeFont: "var(--font-sans)",
    badgeCase: "uppercase",
    badgeTracking: "0.2em",
    badgeWeight: "400",
    badgeText: "0.5625rem",
    badgePad: "0.3125rem 0.625rem",
    tabs: "underline",
    tabsRadius: "0",
    overlayRadius: "0",
    overlayBorder: "1px solid var(--border)",
    overlayShadow: "var(--shadow-xl)",
    labelFont: "var(--font-sans)",
    labelCase: "uppercase",
    labelTracking: "0.2em",
    labelText: "0.625rem",
    labelWeight: "400",
    checkRadius: "0",
    iconStroke: "1",
  },

  skinCss: `
  [data-slot="card"] { background: transparent; }
  [data-slot="card-footer"] { background: transparent; }

  [data-slot="button"] { transition: background-color 400ms ease, color 400ms ease, border-color 400ms ease; }
  [data-slot="button"][data-variant="outline"] { border-color: var(--primary); color: var(--primary); background: transparent; }
  [data-slot="button"][data-variant="outline"]:hover { background: var(--primary); color: var(--primary-foreground); }
  [data-slot="button"][data-variant="secondary"] { background: transparent; border-color: var(--border); color: var(--foreground); }

  [data-slot="badge"] { background: transparent; border: 1px solid var(--border); color: var(--muted-foreground); }
  [data-slot="badge"][data-variant="default"] { border-color: var(--primary); color: var(--primary); }
  [data-slot="tabs-trigger"] { text-transform: uppercase; letter-spacing: 0.2em; font-size: 0.6875rem; font-weight: 400; }
  ${TABS_TAB}[data-active] { border-bottom-color: var(--primary); }`,

  layouts: [
    "poster",
    "editorial-column",
    "split-hero",
    "full-bleed-bands",
    "index-list",
    "focus-column",
    "topbar-workspace",
    "master-detail",
  ],

  prose: {
    overview:
      "This app is restrained and expensive-looking. A dark, almost empty page; a fine serif set large; a few words in tiny letterspaced capitals; one muted metallic accent. Restraint is the whole effect — every element added makes it look cheaper.",
    colors:
      "Near-black and soft ivory, with the accent kept muted and metallic — think brass, champagne, sage or oxblood rather than anything bright. Use it for thin lines, a single button and small capitals. Large areas stay dark.",
    typography:
      "The serif is for headings, names and prices, at regular weight and large sizes; use its italic freely for a soft emphasis. Everything functional — navigation, buttons, labels, captions — is the sans in very small uppercase with wide letterspacing (0.2em). Body text is light in weight and widely leaded.",
    layout:
      "Slow the page down. One idea per screen-height, wide margins, and images given room to be looked at — large, full-bleed, or alone in a column. Off-centre placements and a narrow column of text beside a tall image suit it well. Navigation is a few small words, far apart.",
    elevation:
      "None. Hairlines only. A dialog darkens everything behind it deeply.",
    shapes: "Square corners and one-pixel hairlines. Images are tall rectangles, never rounded. A thin rule in the accent is the main ornament.",
    components: {
      button:
        "a wide, tall block with a tiny letterspaced uppercase label; the outline variant is a hairline in the accent that fills slowly on hover.",
      card: "a transparent panel with a hairline border and generous padding; the title is a large serif.",
      input: "a hairline beneath the text; the label above is tiny uppercase.",
      badge: "a tiny outlined uppercase label.",
      tabs: "small uppercase words with a hairline in the accent under the active one.",
      dialog: "a square hairline-bordered sheet over a deeply darkened page.",
    },
    icons: "Hairline icons (1px stroke) at 18–20px, used rarely. Prefer a word to an icon.",
    dos: [
      "Leave most of each screen empty.",
      "Pair a large serif heading with a tiny uppercase label above it.",
      "Use slow transitions (400ms and up) and gentle fades.",
      "Show prices, dates and numbers in the serif.",
    ],
    donts: [
      "Don't use bright or saturated colour, or more than the one accent.",
      "Don't fill cards with a background or stack many of them in a grid.",
      "Don't use bold weights, rounded corners or shadows.",
      "Don't use exclamation marks, emoji or chatty copy.",
    ],
  },
};
