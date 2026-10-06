import type { StyleSpec } from "../types";
import { MONO_FALLBACK, SANS_FALLBACK, staticFont, variableFont } from "./fonts";

export const brutalist: StyleSpec = {
  key: "brutalist",
  name: "Brutalist",
  look: "Raw and loud: thick black outlines, hard offset shadows, oversized type, monospace labels, one blast of colour.",
  suits:
    "Indie products, creative tools, zines, music, events, personal sites, anything for an audience that is bored of polished software.",
  avoid: "Not for anything that has to feel calm and trustworthy: money, health, admin tools.",

  fonts: {
    display: variableFont("Bricolage Grotesque", "bricolage-grotesque", SANS_FALLBACK),
    body: variableFont("Archivo", "archivo", SANS_FALLBACK),
    mono: staticFont("Space Mono", "space-mono", [400, 700], MONO_FALLBACK),
  },
  defaultMode: "light",
  dials: { variance: 8, motion: 5, density: 5 },
  radius: "0rem",

  palette: {
    neutralHue: "accent",
    fencedPrimary: true,
    chartHues: [150, 60, 210, 300],
    light: {
      background: { l: 0.968, c: 0.022 },
      surface: { l: 1, c: 0 },
      foreground: { l: 0.13, c: 0 },
      muted: { l: 0.925, c: 0.03 },
      mutedForeground: { l: 0.4, c: 0.01 },
      border: { l: 0.13, c: 0 },
      primary: { l: 0.74, c: 0.2 },
      wash: { l: 0.9, c: 0.08 },
    },
    dark: {
      background: { l: 0.15, c: 0.01 },
      surface: { l: 0.19, c: 0.012 },
      foreground: { l: 0.97, c: 0 },
      muted: { l: 0.25, c: 0.02 },
      mutedForeground: { l: 0.76, c: 0.01 },
      border: { l: 0.97, c: 0 },
      primary: { l: 0.82, c: 0.19 },
      wash: { l: 0.3, c: 0.08 },
    },
  },

  theme: {
    "--shadow-2xs": "1px 1px 0 0 var(--foreground)",
    "--shadow-xs": "2px 2px 0 0 var(--foreground)",
    "--shadow-sm": "3px 3px 0 0 var(--foreground)",
    "--shadow-md": "5px 5px 0 0 var(--foreground)",
    "--shadow-lg": "8px 8px 0 0 var(--foreground)",
    "--shadow-xl": "12px 12px 0 0 var(--foreground)",
  },

  baseCss: `
  h1, h2, h3, h4 {
    font-family: var(--font-heading);
    font-weight: 800;
    letter-spacing: -0.04em;
    line-height: 0.95;
    text-transform: uppercase;
  }
  ::selection { background: var(--foreground); color: var(--background); }`,

  skin: {
    controlHeight: "2.75rem",
    controlPadX: "1.25rem",
    controlRadius: "0",
    controlText: "0.8125rem",
    borderWidth: "2px",
    buttonFont: "var(--font-mono)",
    buttonWeight: "700",
    buttonTracking: "0.02em",
    buttonCase: "uppercase",
    field: "outlined",
    fieldRadius: "0",
    fieldPadX: "0.875rem",
    cardRadius: "0",
    cardPad: "1.5rem",
    cardBorder: "2px solid var(--foreground)",
    cardShadow: "6px 6px 0 0 var(--foreground)",
    cardTitleSize: "1.375rem",
    cardTitleWeight: "800",
    cardTitleTracking: "-0.03em",
    badgeRadius: "0",
    badgeFont: "var(--font-mono)",
    badgeCase: "uppercase",
    badgeTracking: "0.04em",
    badgeWeight: "700",
    badgeText: "0.6875rem",
    badgePad: "0.1875rem 0.5rem",
    tabs: "boxed",
    tabsRadius: "0",
    overlayRadius: "0",
    overlayBorder: "2px solid var(--foreground)",
    overlayShadow: "10px 10px 0 0 var(--foreground)",
    labelFont: "var(--font-mono)",
    labelCase: "uppercase",
    labelTracking: "0.04em",
    labelText: "0.75rem",
    labelWeight: "700",
    checkRadius: "0",
    iconStroke: "2.5",
  },

  skinCss: `
  /* Every solid control is outlined in ink and stands on a hard shadow that
     collapses when pressed. */
  [data-slot="button"]:not([data-variant="ghost"], [data-variant="link"]) {
    border-color: var(--foreground);
    box-shadow: 4px 4px 0 0 var(--foreground);
    transition: transform 80ms ease-out, box-shadow 80ms ease-out, background-color 120ms;
  }
  [data-slot="button"]:not([data-variant="ghost"], [data-variant="link"]):hover {
    transform: translate(-1px, -1px);
    box-shadow: 5px 5px 0 0 var(--foreground);
  }
  [data-slot="button"]:not([data-variant="ghost"], [data-variant="link"]):active {
    transform: translate(4px, 4px);
    box-shadow: 0 0 0 0 var(--foreground);
  }
  [data-slot="button"][data-variant="default"]:hover { background: var(--primary); }
  [data-slot="button"][data-variant="outline"] { background: var(--card); }
  [data-slot="button"][data-variant="link"] { color: var(--foreground); text-decoration: underline; text-decoration-thickness: 2px; }
  [data-slot="button"][data-variant="secondary"] { background: var(--foreground); color: var(--background); }

  [data-slot="card-title"] { text-transform: uppercase; }
  [data-slot="card-footer"] { background: var(--muted); border-top: 2px solid var(--foreground); }

  [data-slot="input"], [data-slot="textarea"], [data-slot="select-trigger"] {
    background: var(--card);
    border-color: var(--foreground);
  }
  [data-slot="input"]:focus-visible, [data-slot="textarea"]:focus-visible, [data-slot="select-trigger"]:focus-visible {
    border-color: var(--foreground);
    box-shadow: 4px 4px 0 0 var(--primary);
  }

  [data-slot="badge"] { border: 2px solid var(--foreground); }
  [data-slot="badge"][data-variant="outline"] { background: var(--card); }
  [data-slot="checkbox"], [data-slot="switch"] { border-color: var(--foreground); }
  [data-slot="separator"] { background: var(--foreground); }
  [data-slot="table-row"] { border-color: var(--foreground); }`,

  layouts: [
    "poster",
    "bento",
    "full-bleed-bands",
    "split-hero",
    "index-list",
    "topbar-workspace",
    "focus-column",
    "board",
    "split-tool",
  ],

  prose: {
    overview:
      "This app is deliberately raw. Structure is exposed: thick black outlines around everything, shadows that are solid blocks rather than blurs, type set too big, labels in monospace. It should feel like a poster or a zine, made by a person with opinions.",
    colors:
      "Black ink on a tinted page, white for raised surfaces, and one bright accent used in large flat blocks. No gradients, no tints of the accent, no transparency: every colour is solid.",
    typography:
      "Headings are heavy, uppercase and oversized — let a headline fill the width and wrap awkwardly. Body text is a plain grotesk. Anything functional (buttons, labels, tags, table headers, metadata) is uppercase monospace.",
    layout:
      "Crowd things together and let them collide: blocks that touch, a heading that overlaps an image, a rotated sticker in a corner. Mix huge and tiny. Uneven columns are better than even ones.",
    elevation:
      "Depth is a hard offset shadow in solid ink, never a blur. Use the shadow utilities (`shadow-sm` to `shadow-xl`) for more or less lift; they are all solid.",
    shapes: "No rounded corners anywhere. Borders are 2px solid ink. Rules between things are the same weight.",
    components: {
      button:
        "an outlined block with an uppercase monospace label on a hard shadow; it shifts down onto its shadow when pressed.",
      card: "a white block with a 2px ink outline and a solid offset shadow.",
      input: "a white box with a 2px ink outline; focus adds an accent-coloured hard shadow.",
      badge: "a small outlined uppercase monospace tag.",
      tabs: "adjoining outlined cells; the active one is filled with ink.",
      dialog: "an outlined sheet on a large solid shadow.",
    },
    icons: "Heavy line icons at 20–24px. An icon may sit alone in an outlined square as a button.",
    dos: [
      "Fill whole blocks with the accent — a section, a card, a button.",
      "Set one headline per screen so large it has to wrap.",
      "Put monospace labels and numbers next to things: 01, 02, NEW, V1.0.",
      "Rotate a small element a few degrees for emphasis (`-rotate-2`).",
    ],
    donts: [
      "Don't blur, fade or soften anything: no blurred shadows, no gradients, no translucent overlays.",
      "Don't round corners.",
      "Don't use thin grey borders; a border is ink or it is absent.",
      "Don't space everything out evenly and politely.",
      "Don't set text in the accent colour; the accent is for filling blocks.",
    ],
  },
};
