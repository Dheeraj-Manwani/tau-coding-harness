import type { StyleSpec } from "../types";
import { SANS_FALLBACK, SYSTEM_MONO, variableFont } from "./fonts";

export const soft: StyleSpec = {
  key: "soft",
  name: "Soft",
  look: "Gentle and friendly: large rounded shapes, pastel surfaces tinted by the accent, diffuse coloured shadows, nothing sharp.",
  suits:
    "Wellness, habits, journaling, personal finance, family and consumer apps, anything people use daily and should feel kind.",
  avoid: "Not for dense professional tools, or for anything meant to be edgy or formal.",
  group: "tactile",
  reach: "general",

  fonts: {
    display: variableFont("Outfit", "outfit", SANS_FALLBACK),
    body: variableFont("Figtree", "figtree", SANS_FALLBACK),
    mono: SYSTEM_MONO,
  },
  fontOptions: [
    {
      key: "quicksand",
      label: "Quicksand + Nunito Sans",
      fonts: {
        display: variableFont("Quicksand", "quicksand", SANS_FALLBACK),
        body: variableFont("Nunito Sans", "nunito-sans", SANS_FALLBACK),
        mono: SYSTEM_MONO,
      },
    },
    {
      key: "jakarta",
      label: "Plus Jakarta Sans",
      fonts: {
        display: variableFont("Plus Jakarta Sans", "plus-jakarta-sans", SANS_FALLBACK),
        body: variableFont("Plus Jakarta Sans", "plus-jakarta-sans", SANS_FALLBACK),
        mono: SYSTEM_MONO,
      },
    },
  ],
  defaultMode: "light",
  dials: { variance: 4, motion: 6, density: 3 },
  radius: "1rem",

  palette: {
    neutralHue: "accent",
    chartHues: [40, -40, 80, -80],
    light: {
      background: { l: 0.972, c: 0.018 },
      surface: { l: 1, c: 0 },
      foreground: { l: 0.27, c: 0.03 },
      muted: { l: 0.945, c: 0.025 },
      mutedForeground: { l: 0.52, c: 0.03 },
      border: { l: 0.915, c: 0.025 },
      primary: { l: 0.6, c: 0.15 },
      wash: { l: 0.93, c: 0.045 },
    },
    dark: {
      background: { l: 0.2, c: 0.025 },
      surface: { l: 0.245, c: 0.03 },
      foreground: { l: 0.95, c: 0.015 },
      muted: { l: 0.29, c: 0.03 },
      mutedForeground: { l: 0.75, c: 0.03 },
      border: { l: 0.34, c: 0.03 },
      primary: { l: 0.77, c: 0.12 },
      wash: { l: 0.32, c: 0.05 },
    },
  },

  theme: {
    "--shadow-2xs": "0 1px 2px 0 color-mix(in oklab, var(--primary) 8%, transparent)",
    "--shadow-xs": "0 2px 6px -2px color-mix(in oklab, var(--primary) 14%, transparent)",
    "--shadow-sm": "0 6px 16px -8px color-mix(in oklab, var(--primary) 24%, transparent)",
    "--shadow-md": "0 12px 32px -14px color-mix(in oklab, var(--primary) 30%, transparent)",
    "--shadow-lg": "0 24px 56px -24px color-mix(in oklab, var(--primary) 36%, transparent)",
    "--shadow-xl": "0 36px 80px -32px color-mix(in oklab, var(--primary) 42%, transparent)",
  },

  baseCss: `
  h1, h2, h3, h4 {
    font-family: var(--font-heading);
    font-weight: 600;
    letter-spacing: -0.02em;
    line-height: 1.12;
  }`,

  skin: {
    controlHeight: "2.75rem",
    controlPadX: "1.375rem",
    controlRadius: "9999px",
    controlText: "0.9375rem",
    borderWidth: "1px",
    buttonFont: "var(--font-sans)",
    buttonWeight: "600",
    buttonTracking: "0",
    buttonCase: "none",
    field: "filled",
    fieldRadius: "0.875rem",
    fieldPadX: "1rem",
    cardRadius: "1.5rem",
    cardPad: "1.5rem",
    cardBorder: "0",
    cardShadow: "var(--shadow-md)",
    cardTitleSize: "1.125rem",
    cardTitleWeight: "600",
    cardTitleTracking: "-0.01em",
    badgeRadius: "9999px",
    badgeFont: "var(--font-sans)",
    badgeCase: "none",
    badgeTracking: "0",
    badgeWeight: "600",
    badgeText: "0.75rem",
    badgePad: "0.25rem 0.625rem",
    tabs: "segmented",
    tabsRadius: "9999px",
    overlayRadius: "1.5rem",
    overlayBorder: "0",
    overlayShadow: "var(--shadow-xl)",
    labelFont: "var(--font-sans)",
    labelCase: "none",
    labelTracking: "0",
    labelText: "0.875rem",
    labelWeight: "600",
    checkRadius: "0.4375rem",
    iconStroke: "2",
  },

  skinCss: `
  [data-slot="button"] { transition: transform 160ms cubic-bezier(0.34, 1.56, 0.64, 1), background-color 160ms, box-shadow 160ms; }
  [data-slot="button"][data-variant="default"] { box-shadow: var(--shadow-sm); }
  [data-slot="button"][data-variant="default"]:hover { transform: translateY(-1px); box-shadow: var(--shadow-md); }
  [data-slot="button"]:active { transform: scale(0.97); }
  [data-slot="button"][data-variant="secondary"] { background: var(--accent); color: var(--accent-foreground); }
  [data-slot="button"][data-variant="outline"] { background: var(--card); border-color: var(--border); }

  /* Badges are tinted with the accent rather than filled with it. */
  [data-slot="badge"][data-variant="default"] {
    background: color-mix(in oklab, var(--primary) 16%, var(--card));
    color: color-mix(in oklab, var(--primary) 70%, var(--foreground));
  }
  [data-slot="card-footer"] { background: transparent; border-top: 0; }
  [data-slot="dialog-overlay"], [data-slot="alert-dialog-overlay"], [data-slot="sheet-overlay"] {
    background: color-mix(in oklab, var(--foreground) 28%, transparent);
    backdrop-filter: blur(6px);
  }`,

  layouts: [
    "split-hero",
    "bento",
    "full-bleed-bands",
    "focus-column",
    "topbar-workspace",
    "sidebar-shell",
    "dashboard-grid",
    "board",
  ],

  prose: {
    overview:
      "This app is soft and approachable. Everything is rounded, surfaces float on shadows the colour of the accent, and the page itself carries a faint tint. It should feel calm to open and pleasant to touch, like a well-designed consumer app on a phone.",
    colors:
      "A pale page tinted with the accent, white cards on top of it, and the accent itself at a gentle strength. Lean on tints: a 10–16% mix of the accent for highlights and selected states (`bg-primary/10`, `bg-accent`). Text is a deep tinted ink, never pure black.",
    typography:
      "A rounded geometric face for headings at semibold, a friendly sans for text. Sizes are comfortable rather than dramatic. Write in sentence case and in a warm, plain voice.",
    layout:
      "Give everything room. Group related things into white cards on the tinted page, with large gaps between groups. Keep content in a comfortable central width rather than stretching edge to edge.",
    elevation:
      "Cards float on wide, soft shadows tinted with the accent. Use `shadow-sm` for resting things and `shadow-lg` for things being held or hovered. Never a hard edge or a grey shadow.",
    shapes: "Very round: pills for buttons and tags, 24px corners on cards, 14px on fields. No visible borders on cards.",
    components: {
      button: "a pill with a soft coloured shadow that lifts on hover and squashes slightly when pressed.",
      card: "a white, borderless, very rounded panel floating on a tinted shadow.",
      input: "a rounded tinted field with no border until it is focused.",
      badge: "a pill tinted with the accent.",
      tabs: "a pill-shaped tray with a white pill for the active tab.",
      dialog: "a very rounded sheet over a blurred, dimmed page.",
    },
    icons: "Rounded line icons at 20px, often inside a tinted circle (`bg-primary/10 text-primary rounded-full`).",
    dos: [
      "Put an icon in a tinted circle beside a heading or a figure.",
      "Show progress and streaks with rounded bars and rings.",
      "Use generous padding inside cards (`p-6` or more).",
      "Celebrate small wins with a gentle animation.",
    ],
    donts: [
      "Don't draw borders around cards or use hard lines to divide things.",
      "Don't use pure black, pure grey shadows, or sharp corners.",
      "Don't crowd a screen; move things to another section instead.",
      "Don't use the accent at full strength over large areas.",
    ],
  },
};
