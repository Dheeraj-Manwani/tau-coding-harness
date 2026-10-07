import type { StyleSpec } from "../types";
import { MONO_FALLBACK, SANS_FALLBACK, SERIF_FALLBACK, staticFont, variableFont } from "./fonts";

const mono = staticFont("IBM Plex Mono", "ibm-plex-mono", [400, 500, 600], MONO_FALLBACK);
const franklin = variableFont("Libre Franklin", "libre-franklin", SANS_FALLBACK);

export const formal: StyleSpec = {
  key: "formal",
  name: "Formal",
  look: "Institutional and trustworthy: a sober serif for headings, a clear sans for everything else, white paper with a deep accent, ruled panels, nothing that moves.",
  suits:
    "Law, finance, insurance and accounting, healthcare, government and public services, universities, consultancies, business-to-business — anything that has to be believed before it is liked.",
  avoid: "Not for entertainment, children, or brands that want to feel young, playful or rebellious.",
  group: "crafted",

  fonts: {
    display: variableFont("Source Serif 4", "source-serif-4", SERIF_FALLBACK, { italic: true }),
    body: variableFont("Public Sans", "public-sans", SANS_FALLBACK),
    mono,
  },
  fontOptions: [
    {
      key: "franklin",
      label: "Libre Franklin",
      fonts: { display: franklin, body: franklin, mono },
    },
    {
      key: "noto",
      label: "Noto Serif + Noto Sans",
      fonts: {
        display: variableFont("Noto Serif", "noto-serif", SERIF_FALLBACK, { italic: true }),
        body: variableFont("Noto Sans", "noto-sans", SANS_FALLBACK),
        mono,
      },
    },
  ],
  defaultMode: "light",
  dials: { variance: 2, motion: 2, density: 5 },
  radius: "0.25rem",

  palette: {
    neutralHue: 250,
    chartHues: [30, -30, 150, 200],
    light: {
      background: { l: 0.985, c: 0.003 },
      surface: { l: 1, c: 0 },
      foreground: { l: 0.22, c: 0.02 },
      muted: { l: 0.955, c: 0.006 },
      mutedForeground: { l: 0.47, c: 0.015 },
      border: { l: 0.88, c: 0.008 },
      primary: { l: 0.4, c: 0.12 },
      wash: { l: 0.94, c: 0.02 },
    },
    dark: {
      background: { l: 0.18, c: 0.012 },
      surface: { l: 0.215, c: 0.014 },
      foreground: { l: 0.94, c: 0.008 },
      muted: { l: 0.26, c: 0.014 },
      mutedForeground: { l: 0.72, c: 0.014 },
      border: { l: 0.34, c: 0.016 },
      primary: { l: 0.74, c: 0.1 },
      wash: { l: 0.28, c: 0.03 },
    },
  },

  theme: {
    "--shadow-2xs": "none",
    "--shadow-xs": "0 1px 1px 0 rgb(0 0 0 / 0.04)",
    "--shadow-sm": "0 1px 2px 0 rgb(0 0 0 / 0.06)",
    "--shadow-md": "0 2px 6px -1px rgb(0 0 0 / 0.08)",
    "--shadow-lg": "0 12px 28px -12px rgb(0 0 0 / 0.18)",
    "--shadow-xl": "0 24px 48px -20px rgb(0 0 0 / 0.24)",
  },

  baseCss: `
  h1, h2, h3, h4 {
    font-family: var(--font-heading);
    font-weight: 600;
    letter-spacing: -0.01em;
    line-height: 1.2;
    text-wrap: balance;
  }
  p { text-wrap: pretty; }`,

  skin: {
    controlHeight: "2.5rem",
    controlPadX: "1.125rem",
    controlRadius: "0.25rem",
    controlText: "0.9375rem",
    borderWidth: "1px",
    buttonFont: "var(--font-sans)",
    buttonWeight: "600",
    buttonTracking: "0",
    buttonCase: "none",
    field: "outlined",
    fieldRadius: "0.25rem",
    fieldPadX: "0.75rem",
    cardRadius: "0.375rem",
    cardPad: "1.5rem",
    cardBorder: "1px solid var(--border)",
    cardShadow: "none",
    cardTitleSize: "1.125rem",
    cardTitleWeight: "600",
    cardTitleTracking: "-0.005em",
    badgeRadius: "0.1875rem",
    badgeFont: "var(--font-sans)",
    badgeCase: "none",
    badgeTracking: "0",
    badgeWeight: "600",
    badgeText: "0.75rem",
    badgePad: "0.125rem 0.5rem",
    tabs: "underline",
    tabsRadius: "0",
    overlayRadius: "0.375rem",
    overlayBorder: "1px solid var(--border)",
    overlayShadow: "var(--shadow-xl)",
    labelFont: "var(--font-sans)",
    labelCase: "none",
    labelTracking: "0",
    labelText: "0.875rem",
    labelWeight: "600",
    checkRadius: "0.1875rem",
    iconStroke: "1.75",
  },

  skinCss: `
  /* A panel is a ruled document: a thin rule of the accent across its top. */
  [data-slot="card"] { border-top: 2px solid var(--primary); }
  [data-slot="card-title"] { font-family: var(--font-heading); }
  [data-slot="card-footer"] { background: var(--muted); border-top: 1px solid var(--border); }

  [data-slot="button"][data-variant="outline"] { background: var(--card); border-color: color-mix(in oklab, var(--foreground) 35%, var(--border)); }
  [data-slot="button"][data-variant="outline"]:hover { background: var(--muted); }

  /* Badges are quiet: a pale tint of the accent with dark text. */
  [data-slot="badge"][data-variant="default"] {
    background: color-mix(in oklab, var(--primary) 12%, var(--card));
    color: color-mix(in oklab, var(--primary) 80%, var(--foreground));
  }`,

  layouts: [
    "split-hero",
    "full-bleed-bands",
    "editorial-column",
    "index-list",
    "sidebar-shell",
    "topbar-workspace",
    "dashboard-grid",
    "master-detail",
    "focus-column",
  ],

  prose: {
    overview:
      "This app has to be trusted. It is orderly, restrained and conventional on purpose: a serif for headings, a plain sans for text, white paper, one deep accent, thin grey rules. Nothing surprises, nothing bounces, and everything is where a careful reader expects it.",
    colors:
      "White and near-white, dark ink, and one deep accent — the colour of a letterhead — on the primary action, links and the rule across the top of a panel. Status colours are for status only. No bright or playful colour anywhere.",
    typography:
      "Headings in the serif at semibold, never huge: the largest heading on a page is two or three steps above body, not ten. Text in a clear sans at a comfortable size. Sentence case everywhere; no uppercase labels, no letterspacing.",
    layout:
      "Symmetric and predictable. Content sits in an even grid or a centred column with consistent margins. State plainly what the organisation does, for whom, and how to get in touch; put facts — figures, credentials, dates — in tables and ruled lists.",
    elevation:
      "Flat. Panels are outlined, not raised; a faint shadow is acceptable under a menu or dialog and nowhere else.",
    shapes: "Small radii — 4px on controls, 6px on panels — and one-pixel grey borders.",
    components: {
      button: "a plainly labelled 40px block in the accent; the outline variant is white with a grey border.",
      card: "a white outlined panel with a thin rule of the accent across the top and a serif title.",
      input: "a white field with a grey border and a clear label above it.",
      badge: "a small squared label on a pale tint of the accent.",
      tabs: "plain words with a rule under the active one.",
      dialog: "a squared white sheet with a grey border.",
    },
    icons: "Line icons at 16–18px beside text, to aid scanning. Never as illustration.",
    dos: [
      "Lead with what the organisation does and who it serves, in one plain sentence.",
      "Show credentials, figures and contact details in ruled tables or lists.",
      "Label every form field and say what happens after it is submitted.",
      "Use photographs of real people and places, formally composed.",
    ],
    donts: [
      "Don't animate anything beyond a colour change on hover.",
      "Don't use oversized headings, slanted layouts or overlapping elements.",
      "Don't use slang, exclamation marks or jokes in the copy.",
      "Don't use more than one accent colour.",
    ],
  },
};
