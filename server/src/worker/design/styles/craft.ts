import type { StyleSpec } from "../types";
import { SANS_FALLBACK, SERIF_FALLBACK, SYSTEM_MONO, variableFont } from "./fonts";

export const craft: StyleSpec = {
  key: "craft",
  name: "Craft",
  look: "Handmade and warm: a soft bookish serif, kraft-paper tones, gently rounded shapes with a warm outline, labels like rubber stamps.",
  suits:
    "Cafés and bakeries, makers and small shops, farms, florists, markets, recipes, workshops, studios, anything local and made by people you could meet.",
  avoid: "Not for software dashboards, or for anything that should feel technical, corporate or futuristic.",

  fonts: {
    display: variableFont("Lora", "lora", SERIF_FALLBACK, { italic: true }),
    body: variableFont("Nunito Sans", "nunito-sans", SANS_FALLBACK),
    mono: SYSTEM_MONO,
  },
  fontOptions: [
    {
      key: "vollkorn",
      label: "Vollkorn + Cabin",
      fonts: {
        display: variableFont("Vollkorn", "vollkorn", SERIF_FALLBACK, { italic: true }),
        body: variableFont("Cabin", "cabin", SANS_FALLBACK),
        mono: SYSTEM_MONO,
      },
    },
    {
      key: "bitter",
      label: "Bitter + Work Sans",
      fonts: {
        display: variableFont("Bitter", "bitter", SERIF_FALLBACK),
        body: variableFont("Work Sans", "work-sans", SANS_FALLBACK),
        mono: SYSTEM_MONO,
      },
    },
  ],
  defaultMode: "light",
  dials: { variance: 5, motion: 3, density: 4 },
  radius: "0.5rem",

  palette: {
    neutralHue: 70,
    chartHues: [35, -35, 90, 160],
    light: {
      background: { l: 0.955, c: 0.022 },
      surface: { l: 0.985, c: 0.012 },
      foreground: { l: 0.26, c: 0.03 },
      muted: { l: 0.925, c: 0.025 },
      mutedForeground: { l: 0.5, c: 0.03 },
      border: { l: 0.84, c: 0.03 },
      primary: { l: 0.5, c: 0.12 },
      wash: { l: 0.915, c: 0.04 },
    },
    dark: {
      background: { l: 0.2, c: 0.015 },
      surface: { l: 0.24, c: 0.018 },
      foreground: { l: 0.93, c: 0.02 },
      muted: { l: 0.28, c: 0.02 },
      mutedForeground: { l: 0.72, c: 0.025 },
      border: { l: 0.36, c: 0.022 },
      primary: { l: 0.76, c: 0.1 },
      wash: { l: 0.3, c: 0.035 },
    },
  },

  theme: {
    "--text-base": "1.0625rem",
    "--text-base--line-height": "1.65",
    "--shadow-2xs": "none",
    "--shadow-xs": "0 1px 0 0 var(--border)",
    "--shadow-sm": "0 2px 0 0 var(--border)",
    "--shadow-md": "0 3px 0 0 var(--border)",
    "--shadow-lg": "0 16px 36px -22px rgb(70 45 20 / 0.4)",
    "--shadow-xl": "0 28px 60px -30px rgb(70 45 20 / 0.45)",
  },

  baseCss: `
  h1, h2, h3, h4 {
    font-family: var(--font-heading);
    font-weight: 500;
    letter-spacing: -0.01em;
    line-height: 1.15;
    text-wrap: balance;
  }
  p { text-wrap: pretty; }
  em, i { font-family: var(--font-heading); }`,

  skin: {
    controlHeight: "2.75rem",
    controlPadX: "1.25rem",
    controlRadius: "0.5rem",
    controlText: "0.9375rem",
    borderWidth: "1.5px",
    buttonFont: "var(--font-sans)",
    buttonWeight: "700",
    buttonTracking: "0",
    buttonCase: "none",
    field: "outlined",
    fieldRadius: "0.5rem",
    fieldPadX: "0.875rem",
    cardRadius: "0.75rem",
    cardPad: "1.5rem",
    cardBorder: "1.5px solid var(--border)",
    cardShadow: "var(--shadow-md)",
    cardTitleSize: "1.25rem",
    cardTitleWeight: "500",
    cardTitleTracking: "-0.01em",
    badgeRadius: "0.25rem",
    badgeFont: "var(--font-sans)",
    badgeCase: "uppercase",
    badgeTracking: "0.08em",
    badgeWeight: "800",
    badgeText: "0.6875rem",
    badgePad: "0.1875rem 0.5rem",
    tabs: "underline",
    tabsRadius: "0",
    overlayRadius: "0.75rem",
    overlayBorder: "1.5px solid var(--border)",
    overlayShadow: "var(--shadow-xl)",
    labelFont: "var(--font-sans)",
    labelCase: "none",
    labelTracking: "0",
    labelText: "0.875rem",
    labelWeight: "700",
    checkRadius: "0.25rem",
    iconStroke: "1.75",
  },

  skinCss: `
  /* A primary button sits on a darker edge, like a pressed block of wood. */
  [data-slot="button"] { transition: transform 120ms ease, box-shadow 120ms ease, background-color 120ms ease; }
  [data-slot="button"][data-variant="default"] {
    box-shadow: 0 3px 0 0 color-mix(in oklab, var(--primary) 68%, black);
  }
  [data-slot="button"][data-variant="default"]:hover { transform: translateY(-1px); }
  [data-slot="button"][data-variant="default"]:active {
    transform: translateY(2px);
    box-shadow: 0 1px 0 0 color-mix(in oklab, var(--primary) 68%, black);
  }
  [data-slot="button"][data-variant="outline"] { background: var(--card); border-color: var(--border); }
  [data-slot="button"][data-variant="outline"]:hover { border-color: var(--foreground); }

  [data-slot="card-title"] { font-family: var(--font-heading); }

  /* Badges are rubber stamps: a dashed outline in the accent, never a fill. */
  [data-slot="badge"] {
    background: transparent;
    border: 1.5px dashed currentColor;
    color: var(--muted-foreground);
  }
  [data-slot="badge"][data-variant="default"] { color: var(--primary); }`,

  layouts: [
    "split-hero",
    "editorial-column",
    "full-bleed-bands",
    "index-list",
    "bento",
    "focus-column",
    "topbar-workspace",
  ],

  prose: {
    overview:
      "This app feels made by hand, by people. Warm paper colours, a friendly serif for headings, shapes that are rounded but not bubbly, and thin warm outlines around things. It should read like the menu board or the label on something from a good small shop.",
    colors:
      "Kraft and cream for the page and its panels, a warm dark brown for text, and one accent used like a brand stamp: on the main button, on a label, on a detail. Nothing is pure white, pure black or cool grey.",
    typography:
      "Headings in the serif at medium weight, in sentence case; its italic is for a word of warmth or emphasis. Text in a soft, readable sans. Small uppercase labels are for stamps and tags only.",
    layout:
      "Lay things out like a well-kept counter: clear groups, real photographs of real things, and enough room that nothing feels processed. Alternate text and image side to side down a page rather than stacking identical rows.",
    elevation:
      "Panels sit on a thin warm edge beneath them, like card on a table, rather than floating on a blur. Only a dialog casts a real shadow.",
    shapes: "Gently rounded — 8px on controls, 12px on panels — with a 1.5px warm outline. Photographs get the same soft corners.",
    components: {
      button: "a rounded block with a darker edge beneath it that presses down when clicked.",
      card: "a cream panel with a thin warm outline and a small hard edge beneath, with a serif title.",
      input: "a cream field with a thin warm outline.",
      badge: "a small uppercase label in a dashed outline, like a rubber stamp.",
      tabs: "plain words with a rule under the active one.",
      dialog: "a rounded cream sheet with a warm outline.",
    },
    icons: "Line icons at 18–20px, used with text rather than alone.",
    dos: [
      "Use photographs of the actual things: the food, the place, the hands making it.",
      "Put a stamped label above a heading to say what a section is.",
      "Write the way the owner would speak to a customer.",
      "Give prices, hours and addresses plainly, where they are easy to find.",
    ],
    donts: [
      "Don't use cool greys, pure white panels or pure black text.",
      "Don't use sharp square corners or pill shapes.",
      "Don't fill badges with colour.",
      "Don't use stock imagery of offices, laptops or abstract shapes.",
    ],
  },
};
