import type { StyleSpec } from "../types";
import { SANS_FALLBACK, SERIF_FALLBACK, SYSTEM_MONO, variableFont } from "./fonts";

export const editorial: StyleSpec = {
  key: "editorial",
  name: "Editorial",
  look: "A printed magazine on screen: a serif display face, warm paper, hairline rules instead of boxes, wide margins.",
  suits:
    "Brands with a story, food and drink, publications, portfolios, hospitality, craft, anything that should feel considered rather than technical.",
  avoid: "Not for dense tools used all day, or for anything meant to be playful.",

  fonts: {
    display: variableFont("Fraunces", "fraunces", SERIF_FALLBACK, { italic: true }),
    body: variableFont("Instrument Sans", "instrument-sans", SANS_FALLBACK),
    mono: SYSTEM_MONO,
  },
  defaultMode: "light",
  dials: { variance: 6, motion: 3, density: 3 },
  radius: "0.125rem",

  palette: {
    neutralHue: 75,
    chartHues: [28, -30, 150, 190],
    light: {
      background: { l: 0.972, c: 0.012 },
      surface: { l: 0.988, c: 0.008 },
      foreground: { l: 0.2, c: 0.015 },
      muted: { l: 0.938, c: 0.014 },
      mutedForeground: { l: 0.5, c: 0.02 },
      border: { l: 0.855, c: 0.016 },
      primary: { l: 0.47, c: 0.14 },
      wash: { l: 0.93, c: 0.03 },
    },
    dark: {
      background: { l: 0.17, c: 0.01 },
      surface: { l: 0.205, c: 0.012 },
      foreground: { l: 0.93, c: 0.015 },
      muted: { l: 0.25, c: 0.012 },
      mutedForeground: { l: 0.7, c: 0.02 },
      border: { l: 0.33, c: 0.014 },
      primary: { l: 0.78, c: 0.11 },
      wash: { l: 0.27, c: 0.03 },
    },
  },

  theme: {
    "--text-base": "1.0625rem",
    "--text-base--line-height": "1.7",
    "--text-lg": "1.25rem",
    "--text-lg--line-height": "1.6",
    "--shadow-2xs": "none",
    "--shadow-xs": "none",
    "--shadow-sm": "none",
    "--shadow-md": "0 1px 0 0 var(--border)",
    "--shadow-lg": "0 18px 50px -28px rgb(0 0 0 / 0.35)",
    "--shadow-xl": "0 30px 70px -36px rgb(0 0 0 / 0.4)",
  },

  baseCss: `
  h1, h2, h3, h4 {
    font-family: var(--font-heading);
    font-weight: 400;
    letter-spacing: -0.02em;
    line-height: 1.08;
    text-wrap: balance;
  }
  p { text-wrap: pretty; }
  em, i { font-family: var(--font-heading); }
  hr { border-color: var(--foreground); }`,

  skin: {
    controlHeight: "2.625rem",
    controlPadX: "1.375rem",
    controlRadius: "0",
    controlText: "0.75rem",
    borderWidth: "1px",
    buttonFont: "var(--font-sans)",
    buttonWeight: "500",
    buttonTracking: "0.1em",
    buttonCase: "uppercase",
    field: "underline",
    fieldRadius: "0",
    fieldPadX: "0",
    cardRadius: "0",
    cardPad: "1.5rem",
    cardBorder: "0",
    cardShadow: "none",
    cardTitleSize: "1.5rem",
    cardTitleWeight: "400",
    cardTitleTracking: "-0.015em",
    badgeRadius: "0",
    badgeFont: "var(--font-sans)",
    badgeCase: "uppercase",
    badgeTracking: "0.12em",
    badgeWeight: "500",
    badgeText: "0.625rem",
    badgePad: "0.25rem 0.5rem",
    tabs: "underline",
    tabsRadius: "0",
    overlayRadius: "0",
    overlayBorder: "1px solid var(--foreground)",
    overlayShadow: "var(--shadow-lg)",
    labelFont: "var(--font-sans)",
    labelCase: "uppercase",
    labelTracking: "0.12em",
    labelText: "0.6875rem",
    labelWeight: "500",
    checkRadius: "0",
    iconStroke: "1.25",
  },

  skinCss: `
  /* A card is a ruled section, not a box: one strong rule above, air below. */
  [data-slot="card"] {
    background: transparent;
    border-top: 1px solid var(--foreground);
    padding-inline: 0;
  }
  [data-slot="card-header"], [data-slot="card-content"] { padding-inline: 0; }
  [data-slot="card-footer"] {
    background: transparent;
    border-top: 1px solid var(--border);
    padding-inline: 0;
  }

  [data-slot="button"][data-variant="outline"] { border-color: var(--foreground); background: transparent; }
  [data-slot="button"][data-variant="outline"]:hover { background: var(--foreground); color: var(--background); }

  /* Badges are printed labels: outlined, never filled. */
  [data-slot="badge"] {
    background: transparent;
    border: 1px solid currentColor;
    color: var(--foreground);
  }
  [data-slot="badge"][data-variant="default"] { color: var(--primary); }`,

  layouts: [
    "editorial-column",
    "split-hero",
    "index-list",
    "full-bleed-bands",
    "focus-column",
    "topbar-workspace",
    "master-detail",
  ],

  prose: {
    overview:
      "This app looks like a well-made magazine. Typography does the work that boxes, shadows and colour do elsewhere: large serif headings, a quiet sans for everything functional, and thin rules to separate things. Leave more empty space than feels necessary.",
    colors:
      "Warm paper and ink, with the accent used the way a magazine uses a spot colour: a few times per screen, on what matters most. Most of any screen is background and text.",
    typography:
      "Set headings large and light — the display face at regular weight, not bold — and let one heading per screen be far bigger than the rest. Its italic can carry one word or phrase of emphasis — in at most one heading per screen, or it becomes a tic. Small labels are sans, uppercase and letterspaced. Keep body text to about 65 characters a line.",
    layout:
      "Align to a clear column structure and let headings and images break out of it. Sections are divided by a rule and generous space, never by a change of background into a box.",
    elevation:
      "Flat. Nothing casts a shadow except a dialog over the page. Depth comes from rules and from the size of type.",
    shapes: "Square corners throughout. Lines are one pixel. Images are unframed rectangles with no rounding.",
    components: {
      button:
        "small uppercase letterspaced label on a square block; the outline variant is an ink rule that fills on hover.",
      card: "no box — a strong rule across the top, a serif title, text beneath. Do not give it a background or a border.",
      input: "a single rule beneath the text, no box.",
      badge: "a tiny outlined uppercase label.",
      tabs: "plain words with a rule under the active one.",
      dialog: "a square sheet with a one-pixel ink border.",
    },
    icons: "Use icons sparingly, at 16px, as quiet marks beside text. Never as decoration.",
    dos: [
      "Make one heading per screen dramatically large.",
      "Separate sections with a rule and space.",
      "Put small uppercase labels above headings to say what a section is.",
      "Use real photographs, uncropped into simple rectangles.",
    ],
    donts: [
      "Don't put content in rounded, shadowed or filled cards.",
      "Don't set headings in bold.",
      "Don't centre long passages of text.",
      "Don't use the accent for large areas.",
    ],
  },
};
