import type { StyleSpec } from "../types";
import { MONO_FALLBACK, SANS_FALLBACK, variableFont } from "./fonts";

const mono = variableFont("Red Hat Mono", "red-hat-mono", MONO_FALLBACK);

export const neon: StyleSpec = {
  key: "neon",
  name: "Neon",
  look: "After dark and electric: a near-black page tinted by one vivid accent, thin outlines that glow, wide geometric display type.",
  suits:
    "Music and nightlife, gaming and esports, streaming, events and festivals, creator tools, science fiction, anything meant to be used at night and to feel alive.",
  avoid: "Not for anything formal or calming — banking, health, public services — or for long reading.",
  group: "tech",
  reach: "niche",

  fonts: {
    display: variableFont("Oxanium", "oxanium", SANS_FALLBACK),
    body: variableFont("Lexend", "lexend", SANS_FALLBACK),
    mono,
  },
  fontOptions: [
    {
      key: "exo",
      label: "Exo 2 + Sora",
      fonts: {
        display: variableFont("Exo 2", "exo-2", SANS_FALLBACK),
        body: variableFont("Sora", "sora", SANS_FALLBACK),
        mono,
      },
    },
    {
      key: "tektur",
      label: "Tektur + Outfit",
      fonts: {
        display: variableFont("Tektur", "tektur", SANS_FALLBACK),
        body: variableFont("Outfit", "outfit", SANS_FALLBACK),
        mono,
      },
    },
  ],
  defaultMode: "dark",
  dials: { variance: 7, motion: 8, density: 5 },
  radius: "0.75rem",

  palette: {
    neutralHue: "accent",
    chartHues: [60, -60, 120, 180],
    chartLightness: {
      light: [0.6, 0.52, 0.66, 0.46],
      dark: [0.8, 0.74, 0.84, 0.7],
    },
    light: {
      background: { l: 0.975, c: 0.008 },
      surface: { l: 1, c: 0 },
      foreground: { l: 0.2, c: 0.03 },
      muted: { l: 0.94, c: 0.015 },
      mutedForeground: { l: 0.5, c: 0.03 },
      border: { l: 0.88, c: 0.02 },
      primary: { l: 0.55, c: 0.22 },
      wash: { l: 0.93, c: 0.04 },
    },
    dark: {
      background: { l: 0.14, c: 0.025 },
      surface: { l: 0.185, c: 0.03 },
      foreground: { l: 0.95, c: 0.01 },
      muted: { l: 0.23, c: 0.03 },
      mutedForeground: { l: 0.72, c: 0.03 },
      border: { l: 0.3, c: 0.04 },
      primary: { l: 0.8, c: 0.2 },
      wash: { l: 0.25, c: 0.06 },
    },
  },

  theme: {
    "--shadow-2xs": "0 0 0 1px color-mix(in oklab, var(--primary) 18%, transparent)",
    "--shadow-xs": "0 0 0 1px color-mix(in oklab, var(--primary) 28%, transparent)",
    "--shadow-sm": "0 0 14px -4px color-mix(in oklab, var(--primary) 50%, transparent)",
    "--shadow-md": "0 0 26px -6px color-mix(in oklab, var(--primary) 60%, transparent)",
    "--shadow-lg": "0 0 48px -10px color-mix(in oklab, var(--primary) 65%, transparent)",
    "--shadow-xl": "0 0 80px -14px color-mix(in oklab, var(--primary) 70%, transparent)",
  },

  baseCss: `
  h1, h2, h3, h4 {
    font-family: var(--font-heading);
    font-weight: 600;
    letter-spacing: 0.01em;
    line-height: 1.05;
    text-wrap: balance;
  }`,

  skin: {
    controlHeight: "2.75rem",
    controlPadX: "1.5rem",
    controlRadius: "0.625rem",
    controlText: "0.8125rem",
    borderWidth: "1px",
    buttonFont: "var(--font-heading)",
    buttonWeight: "600",
    buttonTracking: "0.08em",
    buttonCase: "uppercase",
    field: "outlined",
    fieldRadius: "0.625rem",
    fieldPadX: "0.875rem",
    cardRadius: "1rem",
    cardPad: "1.5rem",
    cardBorder: "1px solid var(--border)",
    cardShadow: "none",
    cardTitleSize: "1.125rem",
    cardTitleWeight: "600",
    cardTitleTracking: "0.02em",
    badgeRadius: "9999px",
    badgeFont: "var(--font-mono)",
    badgeCase: "uppercase",
    badgeTracking: "0.1em",
    badgeWeight: "500",
    badgeText: "0.625rem",
    badgePad: "0.25rem 0.625rem",
    tabs: "segmented",
    tabsRadius: "0.75rem",
    overlayRadius: "1rem",
    overlayBorder: "1px solid color-mix(in oklab, var(--primary) 45%, var(--border))",
    overlayShadow: "var(--shadow-xl)",
    labelFont: "var(--font-mono)",
    labelCase: "uppercase",
    labelTracking: "0.1em",
    labelText: "0.6875rem",
    labelWeight: "500",
    checkRadius: "0.375rem",
    iconStroke: "1.75",
    iconSize: "1.125rem",
  },

  skinCss: `
  /* The accent glows: the primary button is lit, and lights up further on hover. */
  [data-slot="button"] { transition: box-shadow 180ms ease, transform 180ms ease, background-color 180ms ease, border-color 180ms ease; }
  [data-slot="button"][data-variant="default"] { box-shadow: var(--shadow-md); }
  [data-slot="button"][data-variant="default"]:hover { box-shadow: var(--shadow-lg); transform: translateY(-1px); }
  [data-slot="button"]:active { transform: scale(0.98); }
  [data-slot="button"][data-variant="outline"] {
    background: transparent;
    border-color: color-mix(in oklab, var(--primary) 55%, var(--border));
    color: var(--primary);
  }
  [data-slot="button"][data-variant="outline"]:hover {
    background: color-mix(in oklab, var(--primary) 12%, transparent);
    box-shadow: var(--shadow-sm);
  }

  /* Panels are lit from their edge when touched. */
  [data-slot="card"] { transition: border-color 180ms ease, box-shadow 180ms ease; }
  [data-slot="card"]:hover {
    border-color: color-mix(in oklab, var(--primary) 50%, var(--border));
    box-shadow: var(--shadow-sm);
  }
  [data-slot="card-title"] { font-family: var(--font-heading); }

  [data-slot="badge"] {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--muted-foreground);
  }
  [data-slot="badge"][data-variant="default"] {
    border-color: color-mix(in oklab, var(--primary) 60%, transparent);
    color: var(--primary);
    box-shadow: var(--shadow-2xs);
  }

  [data-slot="input"]:focus-visible, [data-slot="textarea"]:focus-visible, [data-slot="select-trigger"]:focus-visible {
    border-color: var(--primary);
    box-shadow: var(--shadow-sm);
  }
  [data-slot="dialog-overlay"], [data-slot="alert-dialog-overlay"], [data-slot="sheet-overlay"] {
    background: color-mix(in oklab, var(--background) 72%, transparent);
    backdrop-filter: blur(8px);
  }`,

  layouts: [
    "split-hero",
    "poster",
    "bento",
    "full-bleed-bands",
    "dashboard-grid",
    "board",
    "focus-column",
    "topbar-workspace",
  ],

  prose: {
    overview:
      "This app lives at night. The page is close to black and faintly tinted by the accent; the accent itself is vivid and gives off light, as a glow around the things that matter. Type is wide and geometric. It should feel like a venue with the lights down, not like an office tool in dark mode.",
    colors:
      "One saturated accent on near-black. The accent is light as much as colour: it glows around the primary button, outlines the selected thing, and tints borders on hover. Everything else is dark and quiet so that it can. Text is near-white; secondary text is a tinted grey.",
    typography:
      "Headings in the wide display face at semibold; they can be large. Buttons and small labels are uppercase and letterspaced. Body text is a plain, open sans kept at a comfortable size — the display face is never used for paragraphs.",
    layout:
      "Give each screen one lit focal point and let the rest recede into the dark. Large imagery, full-width bands and tiles of unequal size suit it; long columns of text do not.",
    elevation:
      "Depth is light, not shadow. `shadow-sm` to `shadow-xl` are glows in the accent colour, from a faint halo to a strong one. Use them on what is active, selected or primary — a screen where everything glows has no focal point.",
    shapes: "Rounded but not soft: 10px on controls, 16px on panels, pills for tags. Outlines are one pixel.",
    components: {
      button: "an uppercase letterspaced label on a glowing block of the accent; the outline variant is a lit outline with accent text.",
      card: "a dark panel with a thin outline that lights up in the accent on hover.",
      input: "a dark outlined field that glows in the accent when focused.",
      badge: "a small monospace uppercase pill, outlined; the default one is lit in the accent.",
      tabs: "a dark tray with a raised cell for the active tab.",
      dialog: "a rounded dark sheet outlined in the accent, over a blurred page.",
    },
    icons: "Line icons at 18–20px. An icon may take the accent colour when it marks something live or selected.",
    dos: [
      "Use big, dark, atmospheric photographs and let text sit on a darkened part of them.",
      "Make one thing per screen glow, and let it be the thing to press.",
      "Show live states — now playing, online, starting soon — with the accent.",
      "Animate entrances and hover states; this style is meant to move.",
    ],
    donts: [
      "Don't fill large areas with the accent; it is light, not paint.",
      "Don't put a glow on everything.",
      "Don't use gradient-filled text or rainbow gradients.",
      "Don't set paragraphs in the display face or in uppercase.",
    ],
  },
};
