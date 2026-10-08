import type { StyleSpec } from "../types";
import { SANS_FALLBACK, SERIF_FALLBACK, SYSTEM_MONO, variableFont } from "./fonts";

/**
 * Ethereal: light with no weight. Pale pastel pages that glow rather than
 * shine, panels that fade into the page instead of sitting on it, thin type
 * and a lot of air. It is near Glass and is not Glass: Glass is panels of
 * frosted material with a bright hairline edge; here nothing has an edge, and
 * the panels are a lightening of the page that glows at the rim.
 */
export const ethereal: StyleSpec = {
  key: "ethereal",
  name: "Ethereal",
  look: "Weightless and glowing: pale pastel light, thin lettering, panels that fade into the page with a soft halo instead of an edge, a haze of colour behind everything, and misty, soft-focus pictures.",
  suits:
    "Wellness, meditation and sleep, beauty and skincare, a florist or a wedding, a spa or a retreat, a perfume, a poetry or a music page, a dreamy portfolio, anything that should feel gentle, airy and clean.",
  avoid: "Not for dense data, for urgent or serious tools, or for anything that needs strong contrast and clear edges to be used quickly.",
  group: "tactile",
  reach: "niche",
  aka: ["Dreamy", "Soft glow"],
  art: "Ethereal soft-focus photography: pale pastel light, haze and mist, translucent fabrics, petals and water, a gentle glow, airy and weightless, low contrast, dreamy and calm",

  fonts: {
    display: variableFont("Josefin Sans", "josefin-sans", SANS_FALLBACK),
    body: variableFont("Urbanist", "urbanist", SANS_FALLBACK),
    mono: SYSTEM_MONO,
  },
  fontOptions: [
    {
      key: "cormorant",
      label: "Cormorant + Mulish",
      fonts: {
        display: variableFont("Cormorant", "cormorant", SERIF_FALLBACK, { italic: true }),
        body: variableFont("Mulish", "mulish", SANS_FALLBACK),
        mono: SYSTEM_MONO,
      },
    },
    {
      key: "jost",
      label: "Jost + Hanken Grotesk",
      fonts: {
        display: variableFont("Jost", "jost", SANS_FALLBACK),
        body: variableFont("Hanken Grotesk", "hanken-grotesk", SANS_FALLBACK),
        mono: SYSTEM_MONO,
      },
    },
  ],
  defaultMode: "light",
  dials: { variance: 4, motion: 3, density: 2 },
  radius: "1.25rem",

  palette: {
    neutralHue: "accent",
    chartHues: [40, -40, 80, 140],
    chartLightness: {
      light: [0.78, 0.72, 0.84, 0.66],
      dark: [0.8, 0.74, 0.86, 0.68],
    },
    light: {
      background: { l: 0.975, c: 0.016 },
      surface: { l: 0.995, c: 0.008 },
      foreground: { l: 0.34, c: 0.04 },
      muted: { l: 0.95, c: 0.02 },
      mutedForeground: { l: 0.52, c: 0.035 },
      border: { l: 0.92, c: 0.02 },
      primary: { l: 0.58, c: 0.12 },
      wash: { l: 0.94, c: 0.04 },
    },
    dark: {
      background: { l: 0.24, c: 0.04 },
      surface: { l: 0.285, c: 0.04 },
      foreground: { l: 0.95, c: 0.02 },
      muted: { l: 0.31, c: 0.04 },
      mutedForeground: { l: 0.78, c: 0.035 },
      border: { l: 0.36, c: 0.04 },
      primary: { l: 0.8, c: 0.1 },
      wash: { l: 0.33, c: 0.06 },
    },
  },

  theme: {
    "--text-base": "1.0625rem",
    "--text-base--line-height": "1.75",
    "--shadow-2xs": "none",
    "--shadow-xs": "none",
    // A halo, not a drop: the glow of the accent around a panel.
    "--shadow-sm": "0 0 24px -6px color-mix(in oklab, var(--primary) 22%, transparent)",
    "--shadow-md": "0 0 44px -8px color-mix(in oklab, var(--primary) 28%, transparent)",
    "--shadow-lg": "0 0 70px -10px color-mix(in oklab, var(--primary) 34%, transparent)",
    "--shadow-xl": "0 0 100px -12px color-mix(in oklab, var(--primary) 40%, transparent)",
  },

  baseCss: `
  h1, h2, h3, h4 {
    font-family: var(--font-heading);
    font-weight: 300;
    letter-spacing: 0.01em;
    line-height: 1.15;
    text-wrap: balance;
  }
  h1 { font-weight: 200; letter-spacing: 0.02em; }
  p { text-wrap: pretty; }
  img { border-radius: 1.5rem; }`,

  // Hazes of the accent and its neighbours, large and very soft, like light through a curtain.
  backdrop: `
      radial-gradient(40rem 30rem at 12% 8%, color-mix(in oklab, var(--primary) 16%, transparent), transparent 70%),
      radial-gradient(36rem 28rem at 92% 22%, color-mix(in oklab, var(--chart-2) 18%, transparent), transparent 70%),
      radial-gradient(44rem 30rem at 60% 100%, color-mix(in oklab, var(--chart-3) 18%, transparent), transparent 70%)`,

  skin: {
    controlHeight: "2.875rem",
    controlPadX: "1.75rem",
    controlRadius: "9999px",
    controlText: "0.9375rem",
    borderWidth: "1px",
    buttonFont: "var(--font-sans)",
    buttonWeight: "500",
    buttonTracking: "0.04em",
    buttonCase: "none",
    field: "filled",
    fieldRadius: "9999px",
    fieldPadX: "1.375rem",
    cardRadius: "2rem",
    cardPad: "2.25rem",
    cardBorder: "0",
    cardShadow: "var(--shadow-md)",
    cardTitleSize: "1.5rem",
    cardTitleWeight: "300",
    cardTitleTracking: "0.01em",
    badgeRadius: "9999px",
    badgeFont: "var(--font-sans)",
    badgeCase: "none",
    badgeTracking: "0.04em",
    badgeWeight: "500",
    badgeText: "0.8125rem",
    badgePad: "0.25rem 0.875rem",
    tabs: "segmented",
    tabsRadius: "9999px",
    overlayRadius: "2rem",
    overlayBorder: "0",
    overlayShadow: "var(--shadow-xl)",
    labelFont: "var(--font-sans)",
    labelCase: "none",
    labelTracking: "0.03em",
    labelText: "0.875rem",
    labelWeight: "500",
    checkRadius: "9999px",
    iconStroke: "1",
    iconSize: "1.25rem",
  },

  skinCss: `
  [data-slot="button"] { transition: box-shadow 300ms ease, background-color 300ms ease, transform 300ms ease; }
  [data-slot="button"][data-variant="default"] { box-shadow: 0 0 28px -4px color-mix(in oklab, var(--primary) 55%, transparent); }
  [data-slot="button"][data-variant="default"]:hover { box-shadow: 0 0 40px -2px color-mix(in oklab, var(--primary) 70%, transparent); }
  [data-slot="button"][data-variant="outline"] { background: color-mix(in oklab, var(--card) 70%, transparent); border-color: color-mix(in oklab, var(--primary) 35%, transparent); }
  [data-slot="button"][data-variant="outline"]:hover { background: var(--card); }

  /* A panel is the page made a little lighter, glowing at its rim: no edge, and the halo is the accent. */
  [data-slot="card"] { background: color-mix(in oklab, var(--card) 72%, transparent); backdrop-filter: blur(10px); }
  [data-slot="card-title"] { font-family: var(--font-heading); }
  [data-slot="card-footer"] { background: transparent; border-top: 1px solid color-mix(in oklab, var(--primary) 14%, transparent); }

  [data-slot="badge"] { background: color-mix(in oklab, var(--primary) 12%, transparent); color: color-mix(in oklab, var(--primary) 70%, var(--foreground)); border: 0; }
  [data-slot="dialog-content"], [data-slot="alert-dialog-content"] { background: color-mix(in oklab, var(--card) 88%, transparent); backdrop-filter: blur(16px); }`,

  layouts: [
    "split-hero",
    "editorial-column",
    "full-bleed-bands",
    "poster",
    "focus-column",
    "index-list",
    "topbar-workspace",
  ],

  prose: {
    overview:
      "This app is light with no weight. Pale colour hazes the page like sun through a curtain, the lettering is thin, the panels fade into the page and glow at the rim, and everything has more air than it needs. It should feel gentle, clean and a little dreamlike.",
    colors:
      "Near-white pastels tinted with the accent and its neighbours, soft grey-violet text rather than black, and one gentle accent for the main action and its glow. Contrast is lower than usual by intent, but text is always readable: never pale grey on pale. The haze behind the page is the second and third colours, very faint.",
    typography:
      "Headings in a thin, light face, mixed case, with a little letter spacing and a lot of room. Text in a clean, round sans at a comfortable size and a generous line height. Weight stays light; bold is never used, and emphasis is italics or colour.",
    layout:
      "Fewer, larger things with wide margins. Centre a single idea and surround it with space. Let a misty picture fill a whole band, and set the words over a calm, pale part of it. Keep screens short.",
    elevation:
      "No hard shadows. A panel has a halo of the accent colour around it, faint at rest and a little stronger when pointed at. The page glows; nothing casts a shadow.",
    shapes:
      "Everything is round: pill-shaped buttons and fields, large corners on panels, circular checkboxes. No outlines; where an edge is needed, a faint tint of the accent.",
    components: {
      button: "a pill that glows in the accent colour, brighter when pointed at.",
      card: "a pale panel that fades into the page, with no edge and a soft halo, and a thin-lettered title.",
      input: "a soft filled pill with no outline.",
      badge: "a small pill tinted with the accent.",
      tabs: "a pale pill-shaped tray with a lighter pill for the active tab.",
      dialog: "a large frosted sheet with a wide, soft halo.",
    },
    icons: "Hairline icons at 20px, rarely, always beside a word.",
    dos: [
      "Make the artwork with `generate_image`: soft-focus, pastel, misty, with room for words over the calm part.",
      "Leave more space than seems needed, and keep each screen to one idea.",
      "Write short, gentle sentences in the second person.",
      "Fade pictures into the page with soft masks where they meet it.",
    ],
    donts: [
      "Don't use bold weights, black text, hard edges or hard shadows.",
      "Don't use saturated colours or sharp contrast.",
      "Don't use it for dense tables or data.",
      "Don't set pale text on a pale ground.",
    ],
  },
};
