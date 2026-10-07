import type { StyleSpec } from "../types";
import { SANS_FALLBACK, SYSTEM_MONO, variableFont } from "./fonts";
import { TABS_LIST, TABS_TAB } from "./selectors";

const FIELDS = `[data-slot="input"], [data-slot="textarea"], [data-slot="select-trigger"]`;
const FIELDS_FOCUS = `[data-slot="input"]:focus-visible, [data-slot="textarea"]:focus-visible, [data-slot="select-trigger"]:focus-visible`;

export const glass: StyleSpec = {
  key: "glass",
  name: "Glass",
  look: "Frosted glass over colour: translucent, blurred panels with a bright hairline edge, floating on a soft gradient backdrop made from the accent.",
  suits:
    "Health and wellness dashboards, weather, music and media players, smart-home and finance overviews, app landing pages, portfolios — anything that should feel light, modern and a little dreamy.",
  avoid: "Not for long reading, dense tables and admin tools, or for anything formal, handmade or austere.",
  group: "tactile",
  reach: "niche",
  aka: ["Glassmorphism"],

  fonts: {
    display: variableFont("Red Hat Display", "red-hat-display", SANS_FALLBACK),
    body: variableFont("Red Hat Text", "red-hat-text", SANS_FALLBACK),
    mono: SYSTEM_MONO,
  },
  fontOptions: [
    {
      key: "geologica",
      label: "Geologica",
      fonts: {
        display: variableFont("Geologica", "geologica", SANS_FALLBACK),
        body: variableFont("Geologica", "geologica", SANS_FALLBACK),
        mono: SYSTEM_MONO,
      },
    },
    {
      key: "urbanist",
      label: "Urbanist + Golos Text",
      fonts: {
        display: variableFont("Urbanist", "urbanist", SANS_FALLBACK),
        body: variableFont("Golos Text", "golos-text", SANS_FALLBACK),
        mono: SYSTEM_MONO,
      },
    },
  ],
  defaultMode: "light",
  dials: { variance: 6, motion: 6, density: 4 },
  radius: "1rem",

  palette: {
    neutralHue: "accent",
    // The backdrop is made of the accent and these, so they sit near it on the
    // wheel: neighbours blend into one wash of colour, opposites into mud.
    chartHues: [50, -55, 100, 160],
    light: {
      background: { l: 0.955, c: 0.02 },
      surface: { l: 0.995, c: 0.004 },
      foreground: { l: 0.24, c: 0.035 },
      muted: { l: 0.925, c: 0.025 },
      // Stronger than a flat page would need: quiet text may sit on the backdrop.
      mutedForeground: { l: 0.43, c: 0.035 },
      border: { l: 0.89, c: 0.025 },
      primary: { l: 0.56, c: 0.19 },
      wash: { l: 0.92, c: 0.045 },
    },
    dark: {
      background: { l: 0.17, c: 0.035 },
      surface: { l: 0.24, c: 0.04 },
      foreground: { l: 0.96, c: 0.012 },
      muted: { l: 0.275, c: 0.04 },
      mutedForeground: { l: 0.81, c: 0.03 },
      border: { l: 0.36, c: 0.04 },
      primary: { l: 0.76, c: 0.15 },
      wash: { l: 0.31, c: 0.06 },
    },
  },

  theme: {
    "--shadow-2xs": "0 1px 2px 0 rgb(0 0 0 / 0.04)",
    "--shadow-xs": "0 2px 6px -2px rgb(0 0 0 / 0.07)",
    "--shadow-sm": "0 6px 18px -8px rgb(0 0 0 / 0.12)",
    "--shadow-md": "0 14px 36px -16px rgb(0 0 0 / 0.18)",
    "--shadow-lg": "0 26px 60px -24px rgb(0 0 0 / 0.26)",
    "--shadow-xl": "0 40px 90px -32px rgb(0 0 0 / 0.34)",
  },

  baseCss: `
  /* What a pane of glass is made of. Lighter and brighter-edged by day. */
  html {
    --glass: color-mix(in oklab, var(--card) 56%, transparent);
    --glass-strong: color-mix(in oklab, var(--card) 78%, transparent);
    --glass-edge: color-mix(in oklab, white 62%, transparent);
    --glass-blur: blur(22px) saturate(1.6);
  }
  html.dark {
    --glass: color-mix(in oklab, var(--card) 48%, transparent);
    --glass-strong: color-mix(in oklab, var(--card) 76%, transparent);
    --glass-edge: color-mix(in oklab, white 15%, transparent);
  }
  h1, h2, h3, h4 {
    font-family: var(--font-heading);
    font-weight: 600;
    letter-spacing: -0.025em;
    line-height: 1.1;
  }`,

  // Glass needs something behind it. Four soft pools of colour, the accent and
  // its neighbours, each faint enough that text on the bare page still reads.
  backdrop: `
      radial-gradient(60rem 40rem at 10% -10%, color-mix(in oklab, var(--primary) 34%, transparent), transparent 70%),
      radial-gradient(46rem 36rem at 95% 5%, color-mix(in oklab, var(--chart-2) 30%, transparent), transparent 70%),
      radial-gradient(56rem 42rem at 72% 108%, color-mix(in oklab, var(--chart-3) 28%, transparent), transparent 70%),
      radial-gradient(40rem 32rem at 0% 96%, color-mix(in oklab, var(--chart-4) 24%, transparent), transparent 70%)`,

  skin: {
    controlHeight: "2.75rem",
    controlPadX: "1.25rem",
    controlRadius: "0.875rem",
    controlText: "0.9375rem",
    borderWidth: "1px",
    buttonFont: "var(--font-sans)",
    buttonWeight: "600",
    buttonTracking: "0",
    buttonCase: "none",
    field: "filled",
    fieldRadius: "0.875rem",
    fieldPadX: "1rem",
    cardRadius: "1.75rem",
    cardPad: "1.5rem",
    cardBorder: "1px solid var(--glass-edge)",
    cardShadow: "var(--shadow-md)",
    cardTitleSize: "1.0625rem",
    cardTitleWeight: "600",
    cardTitleTracking: "-0.015em",
    badgeRadius: "9999px",
    badgeFont: "var(--font-sans)",
    badgeCase: "none",
    badgeTracking: "0",
    badgeWeight: "600",
    badgeText: "0.75rem",
    badgePad: "0.25rem 0.75rem",
    tabs: "segmented",
    tabsRadius: "1rem",
    overlayRadius: "1.5rem",
    overlayBorder: "1px solid var(--glass-edge)",
    overlayShadow: "var(--shadow-xl)",
    labelFont: "var(--font-sans)",
    labelCase: "none",
    labelTracking: "0",
    labelText: "0.8125rem",
    labelWeight: "600",
    checkRadius: "0.375rem",
    iconStroke: "1.75",
    iconSize: "1.25rem",
  },

  skinCss: `
  /* A panel is a pane: see-through, blurring whatever is behind it. Only while
     it is still the stock surface colour — a card given a fill of its own
     (\`bg-primary\`, \`bg-muted\`) keeps that fill, and the text chosen for it. */
  [data-slot="card"].bg-card { background: var(--glass); }
  [data-slot="card"] {
    -webkit-backdrop-filter: var(--glass-blur);
    backdrop-filter: var(--glass-blur);
    transition: transform 220ms ease, box-shadow 220ms ease;
  }
  a[data-slot="card"]:hover, button[data-slot="card"]:hover { transform: translateY(-2px); box-shadow: var(--shadow-lg); }
  [data-slot="card-footer"] { background: transparent; border-top: 1px solid var(--glass-edge); }

  /* The one solid thing is the main button. Every other control is glass. */
  [data-slot="button"] { transition: transform 160ms ease, box-shadow 160ms ease, background-color 160ms ease; }
  [data-slot="button"][data-variant="default"] {
    box-shadow: inset 0 1px 0 0 color-mix(in oklab, white 30%, transparent), 0 8px 20px -8px color-mix(in oklab, var(--primary) 60%, transparent);
  }
  [data-slot="button"][data-variant="default"]:hover { transform: translateY(-1px); }
  [data-slot="button"]:active { transform: scale(0.98); }
  [data-slot="button"][data-variant="outline"], [data-slot="button"][data-variant="secondary"] {
    background: var(--glass);
    border-color: var(--glass-edge);
    color: var(--foreground);
    -webkit-backdrop-filter: var(--glass-blur);
    backdrop-filter: var(--glass-blur);
  }
  [data-slot="button"][data-variant="outline"]:hover, [data-slot="button"][data-variant="secondary"]:hover { background: var(--glass-strong); }

  ${FIELDS} {
    background: var(--glass);
    border-color: var(--glass-edge);
    -webkit-backdrop-filter: var(--glass-blur);
    backdrop-filter: var(--glass-blur);
  }
  ${FIELDS_FOCUS} { background: var(--glass-strong); border-color: var(--ring); }

  [data-slot="badge"] {
    background: var(--glass);
    border: 1px solid var(--glass-edge);
    color: var(--foreground);
    -webkit-backdrop-filter: var(--glass-blur);
    backdrop-filter: var(--glass-blur);
  }
  [data-slot="badge"][data-variant="default"] {
    background: color-mix(in oklab, var(--primary) 20%, var(--glass));
    color: color-mix(in oklab, var(--primary) 55%, var(--foreground));
  }
  [data-slot="badge"][data-variant="destructive"] { color: var(--destructive); }

  ${TABS_LIST} {
    background: var(--glass);
    border: 1px solid var(--glass-edge);
    -webkit-backdrop-filter: var(--glass-blur);
    backdrop-filter: var(--glass-blur);
  }
  ${TABS_TAB}[data-active] { background: var(--glass-strong); }

  /* Things that open over the page are thicker glass, so their text holds up. */
  [data-slot="dialog-content"], [data-slot="alert-dialog-content"], [data-slot="popover-content"],
  [data-slot="dropdown-menu-content"], [data-slot="select-content"], [data-slot="sheet-content"] {
    background: var(--glass-strong);
    -webkit-backdrop-filter: blur(30px) saturate(1.6);
    backdrop-filter: blur(30px) saturate(1.6);
  }
  [data-slot="dialog-overlay"], [data-slot="alert-dialog-overlay"], [data-slot="sheet-overlay"] {
    background: color-mix(in oklab, var(--background) 45%, transparent);
    backdrop-filter: blur(6px);
  }`,

  layouts: [
    "bento",
    "dashboard-grid",
    "split-hero",
    "full-bleed-bands",
    "sidebar-shell",
    "topbar-workspace",
    "focus-column",
    "master-detail",
  ],

  prose: {
    overview:
      "This app is made of frosted glass. Behind everything is a soft wash of colour; in front of it float translucent panels that blur what is behind them and catch the light along their top edge. It should feel weightless and calm, like a well-made phone widget, with depth you can see through.",
    colors:
      "The colour is in the backdrop, not on the panels: pools of the accent and its neighbouring hues behind the page. Panels are the surface colour made see-through. The accent is solid in one place per screen — the main button, a ring, the key figure. Text is a deep tinted ink.",
    typography:
      "A clean geometric sans, semibold for headings and regular for text. Figures can be large and light. Sentence case, no uppercase labels.",
    layout:
      "Float panels of different sizes over the backdrop with clear gaps between them, so colour shows through and around each one. Let one panel overlap another slightly, or a figure sit half out of its panel, to show the layers.",
    elevation:
      "Depth is transparency first and shadow second. A panel is nearer when it is more opaque and its shadow is wider (`shadow-sm` to `shadow-xl`). Stack at most three layers: backdrop, panel, and something on the panel.",
    shapes: "Generously round: 28px on panels, 14px on controls, pills for tags. Every pane has a one-pixel bright edge instead of a border.",
    components: {
      button: "a solid block of the accent with a lit top edge and a coloured shadow; the outline and secondary variants are panes of glass.",
      card: "a translucent, blurred, very rounded pane with a bright hairline edge and a soft shadow.",
      input: "a glass field that turns more opaque and gains an accent edge when focused.",
      badge: "a glass pill; the default one is tinted with the accent.",
      tabs: "a glass tray with a more opaque pane for the active tab.",
      dialog: "a thick pane of glass over a blurred, dimmed page.",
    },
    icons: "Line icons at 20px, often in a small glass circle or square of their own (`bg-card/50 rounded-full`).",
    dos: [
      "Put content on panels, and let the backdrop show between and around them.",
      "Use `bg-card/40` to `bg-card/70` with `backdrop-blur-xl` for a pane of your own.",
      "Show figures with rings, gauges and smooth line charts drawn in the accent.",
      "Let panels ease in and lift a little on hover.",
    ],
    donts: [
      "Don't give a full-width section a solid background; the glass goes flat.",
      "Don't nest glass more than two deep, or put a long page of text on it.",
      "Don't set small or grey text straight on the backdrop; put it on a panel.",
      "Don't draw dark borders or hard shadows around panes.",
    ],
  },
};
