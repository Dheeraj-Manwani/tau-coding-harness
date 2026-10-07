import type { StyleSpec } from "../types";
import { SANS_FALLBACK, SYSTEM_MONO, variableFont } from "./fonts";
import { TABS_LIST, TABS_TAB } from "./selectors";

export const playful: StyleSpec = {
  key: "playful",
  name: "Playful",
  look: "Toy-box energy: chunky rounded shapes, thick ink outlines, bright blocks of several colours, buttons that squash when pressed.",
  suits:
    "Games, quizzes, kids and learning, party and social apps, fun utilities, anything whose job is to make someone smile.",
  avoid: "Not for anything serious: money, health, work tools.",
  group: "loud",

  fonts: {
    display: variableFont("Fredoka", "fredoka", SANS_FALLBACK),
    body: variableFont("Nunito", "nunito", SANS_FALLBACK),
    mono: SYSTEM_MONO,
  },
  fontOptions: [
    {
      key: "baloo",
      label: "Baloo 2 + Quicksand",
      fonts: {
        display: variableFont("Baloo 2", "baloo-2", SANS_FALLBACK),
        body: variableFont("Quicksand", "quicksand", SANS_FALLBACK),
        mono: SYSTEM_MONO,
      },
    },
    {
      key: "grandstander",
      label: "Grandstander + Nunito",
      fonts: {
        display: variableFont("Grandstander", "grandstander", SANS_FALLBACK),
        body: variableFont("Nunito", "nunito", SANS_FALLBACK),
        mono: SYSTEM_MONO,
      },
    },
  ],
  defaultMode: "light",
  dials: { variance: 7, motion: 8, density: 3 },
  radius: "1rem",

  palette: {
    neutralHue: "accent",
    fencedPrimary: true,
    // Far apart on purpose: this style uses its chart colours as a second,
    // third and fourth colour for blocks and stickers.
    chartHues: [140, 200, 60, 280],
    chartLightness: { light: [0.8, 0.76, 0.85, 0.74], dark: [0.8, 0.76, 0.85, 0.74] },
    light: {
      background: { l: 0.972, c: 0.03 },
      surface: { l: 1, c: 0 },
      foreground: { l: 0.25, c: 0.05 },
      muted: { l: 0.93, c: 0.045 },
      mutedForeground: { l: 0.48, c: 0.05 },
      border: { l: 0.25, c: 0.05 },
      primary: { l: 0.7, c: 0.19 },
      wash: { l: 0.9, c: 0.08 },
    },
    dark: {
      background: { l: 0.22, c: 0.04 },
      surface: { l: 0.275, c: 0.045 },
      foreground: { l: 0.96, c: 0.02 },
      muted: { l: 0.33, c: 0.05 },
      mutedForeground: { l: 0.79, c: 0.04 },
      border: { l: 0.12, c: 0.03 },
      primary: { l: 0.8, c: 0.16 },
      wash: { l: 0.37, c: 0.08 },
    },
  },

  theme: {
    "--shadow-2xs": "0 1px 0 0 var(--border)",
    "--shadow-xs": "0 2px 0 0 var(--border)",
    "--shadow-sm": "0 3px 0 0 var(--border)",
    "--shadow-md": "0 5px 0 0 var(--border)",
    "--shadow-lg": "0 8px 0 0 var(--border)",
    "--shadow-xl": "0 12px 0 0 var(--border)",
  },

  baseCss: `
  h1, h2, h3, h4 {
    font-family: var(--font-heading);
    font-weight: 600;
    letter-spacing: -0.01em;
    line-height: 1.08;
  }
  body { font-weight: 500; }`,

  skin: {
    controlHeight: "3rem",
    controlPadX: "1.5rem",
    controlRadius: "9999px",
    controlText: "1rem",
    borderWidth: "2px",
    buttonFont: "var(--font-heading)",
    buttonWeight: "600",
    buttonTracking: "0.01em",
    buttonCase: "none",
    field: "outlined",
    fieldRadius: "1rem",
    fieldPadX: "1rem",
    cardRadius: "1.5rem",
    cardPad: "1.5rem",
    cardBorder: "2px solid var(--border)",
    cardShadow: "0 6px 0 0 var(--border)",
    cardTitleSize: "1.25rem",
    cardTitleWeight: "600",
    cardTitleTracking: "0",
    badgeRadius: "9999px",
    badgeFont: "var(--font-heading)",
    badgeCase: "none",
    badgeTracking: "0.01em",
    badgeWeight: "600",
    badgeText: "0.8125rem",
    badgePad: "0.1875rem 0.75rem",
    tabs: "segmented",
    tabsRadius: "9999px",
    overlayRadius: "1.75rem",
    overlayBorder: "2px solid var(--border)",
    overlayShadow: "0 10px 0 0 var(--border)",
    labelFont: "var(--font-heading)",
    labelCase: "none",
    labelTracking: "0",
    labelText: "0.9375rem",
    labelWeight: "600",
    checkRadius: "0.5rem",
    iconStroke: "2.5",
  },

  skinCss: `
  /* Buttons are physical: an outlined pill on a solid lip that it sinks onto. */
  [data-slot="button"]:not([data-variant="ghost"], [data-variant="link"]) {
    border-color: var(--border);
    box-shadow: 0 4px 0 0 var(--border);
    transition: transform 120ms cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 120ms ease-out;
  }
  [data-slot="button"]:not([data-variant="ghost"], [data-variant="link"]):hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 0 0 var(--border);
  }
  [data-slot="button"]:not([data-variant="ghost"], [data-variant="link"]):active {
    transform: translateY(4px);
    box-shadow: 0 0 0 0 var(--border);
  }
  [data-slot="button"][data-variant="default"]:hover { background: var(--primary); }
  [data-slot="button"][data-variant="outline"] { background: var(--card); }
  [data-slot="button"][data-variant="link"] { color: var(--foreground); text-decoration: underline; text-decoration-thickness: 2px; }
  [data-slot="button"][data-variant="secondary"] { background: var(--chart-3); color: var(--foreground); }

  [data-slot="card-footer"] { background: var(--muted); border-top: 2px solid var(--border); }
  [data-slot="input"], [data-slot="textarea"], [data-slot="select-trigger"] { background: var(--card); border-color: var(--border); }
  [data-slot="input"]:focus-visible, [data-slot="textarea"]:focus-visible, [data-slot="select-trigger"]:focus-visible {
    border-color: var(--border);
    box-shadow: 0 4px 0 0 var(--primary);
  }
  [data-slot="badge"] { border: 2px solid var(--border); }
  [data-slot="badge"][data-variant="secondary"] { background: var(--chart-4); color: var(--foreground); }
  [data-slot="checkbox"], [data-slot="switch"] { border-color: var(--border); }
  ${TABS_LIST} { border: 2px solid var(--border); background: var(--card); }
  ${TABS_TAB}[data-active] { background: var(--primary); color: var(--primary-foreground); box-shadow: none; }`,

  layouts: [
    "bento",
    "split-hero",
    "poster",
    "full-bleed-bands",
    "focus-column",
    "board",
    "topbar-workspace",
  ],

  prose: {
    overview:
      "This app is a toy, in the best sense. Shapes are fat and round, everything has a thick ink outline and sits on a solid lip like a physical button, and colour comes in bright flat blocks. It should feel bouncy and a bit silly, and it should respond to every touch.",
    colors:
      "This is the one style that uses several colours at once. The accent leads; the chart colours (`bg-chart-2` to `bg-chart-5`) are its playmates for blocks, stickers, avatars and categories. Colours are flat and bright on a tinted page, always fenced by the ink outline. Text is a deep tinted ink, not black.",
    typography:
      "A rounded display face for headings, buttons and labels; a soft rounded sans for sentences. Be generous with size. Copy is short, upbeat and direct — exclamation marks are allowed, sparingly.",
    layout:
      "Big blocks, big gaps, few things per screen. Tilt a card or a sticker a few degrees (`rotate-2`, `-rotate-3`) and let shapes overlap the edges of their containers. Centre a single main action where a thumb can reach it.",
    elevation:
      "Depth is a solid lip beneath an object, in the outline colour — never a blur. The shadow utilities are all solid lips of increasing height. Pressed things sink onto their lip.",
    shapes: "Pills and 24px-rounded blocks with a 2px ink outline. Circles, blobs and stars as decoration are welcome.",
    components: {
      button: "a tall outlined pill on a solid lip; it hops up on hover and sinks flat when pressed.",
      card: "a white block with fat rounded corners, a 2px ink outline and a solid lip beneath.",
      input: "a rounded white field with a 2px ink outline; focus gives it an accent-coloured lip.",
      badge: "an outlined pill in the display face.",
      tabs: "an outlined pill tray; the active tab is a filled accent pill.",
      dialog: "a very rounded outlined sheet on a tall solid lip.",
    },
    icons: "Chunky line icons at 22–28px. An icon in a coloured outlined circle makes a good sticker.",
    dos: [
      "Give different categories different chart colours.",
      "Animate rewards: a bounce, a wiggle, a pop of confetti on success.",
      "Make the main button very large and put it where a thumb lands.",
      "Tilt and overlap one or two elements per screen.",
    ],
    donts: [
      "Don't use blurred shadows, gradients or thin grey lines.",
      "Don't crowd the screen with small controls.",
      "Don't write stiff, formal copy.",
      "Don't leave any filled shape without its outline.",
      "Don't set text in the accent colour; the accent is for filling shapes.",
    ],
  },
};
