import type { StyleSpec } from "../types";
import { SANS_FALLBACK, SYSTEM_MONO, staticFont, variableFont } from "./fonts";
import { TABS_TAB } from "./selectors";

/**
 * The sunset: the accent running into the hue beside it. The far end is only
 * part of the way there, so a label chosen to read on the accent still reads
 * at the other end of the button.
 */
const SUNSET = "linear-gradient(120deg, var(--primary), color-mix(in oklab, var(--primary) 45%, var(--chart-2)))";

export const synthwave: StyleSpec = {
  key: "synthwave",
  name: "Synthwave",
  look: "An eighties sunset that never ends: a violet night, a glowing grid running to the horizon, hot gradients from the accent into the colour beside it, and wide chrome-age lettering that glows.",
  suits:
    "Music, DJs and playlists, retro games and arcades, film nights and festivals, car and synth culture, streamers, nostalgic brands and launch pages.",
  avoid: "Not for work tools, finance, health, news, or anything read at length: it is a mood, not a workspace.",
  group: "tech",
  aka: ["Retrowave", "Outrun"],

  fonts: {
    display: staticFont("Audiowide", "audiowide", [400], SANS_FALLBACK),
    body: variableFont("Kumbh Sans", "kumbh-sans", SANS_FALLBACK),
    mono: SYSTEM_MONO,
  },
  // Each display face has one weight; the base rules set headings at 400.
  fontOptions: [
    {
      key: "righteous",
      label: "Righteous + Josefin Sans",
      fonts: {
        display: staticFont("Righteous", "righteous", [400], SANS_FALLBACK),
        body: variableFont("Josefin Sans", "josefin-sans", SANS_FALLBACK),
        mono: SYSTEM_MONO,
      },
    },
    {
      key: "krona",
      label: "Krona One + Sora",
      fonts: {
        display: staticFont("Krona One", "krona-one", [400], SANS_FALLBACK),
        body: variableFont("Sora", "sora", SANS_FALLBACK),
        mono: SYSTEM_MONO,
      },
    },
  ],
  defaultMode: "dark",
  dials: { variance: 7, motion: 8, density: 4 },
  radius: "0.375rem",

  palette: {
    // The night is violet whatever the accent: that, and the second colour, is
    // what separates this from a dark page with a glow on it.
    neutralHue: 295,
    // The first companion is the other end of the sunset — magenta runs to
    // orange, cyan to blue — so it sits close, and as light as the accent.
    chartHues: [55, -70, 110, 180],
    chartLightness: {
      light: [0.6, 0.56, 0.66, 0.5],
      dark: [0.78, 0.72, 0.82, 0.7],
    },
    light: {
      background: { l: 0.97, c: 0.018 },
      surface: { l: 1, c: 0 },
      foreground: { l: 0.24, c: 0.07 },
      muted: { l: 0.935, c: 0.03 },
      mutedForeground: { l: 0.47, c: 0.06 },
      border: { l: 0.87, c: 0.04 },
      primary: { l: 0.58, c: 0.25 },
      wash: { l: 0.92, c: 0.05 },
    },
    dark: {
      background: { l: 0.16, c: 0.06 },
      surface: { l: 0.21, c: 0.07 },
      foreground: { l: 0.96, c: 0.02 },
      muted: { l: 0.26, c: 0.07 },
      mutedForeground: { l: 0.79, c: 0.05 },
      border: { l: 0.36, c: 0.09 },
      primary: { l: 0.74, c: 0.23 },
      wash: { l: 0.3, c: 0.1 },
    },
  },

  theme: {
    "--shadow-2xs": "0 0 0 1px color-mix(in oklab, var(--primary) 25%, transparent)",
    "--shadow-xs": "0 0 8px -2px color-mix(in oklab, var(--primary) 45%, transparent)",
    "--shadow-sm": "0 0 16px -4px color-mix(in oklab, var(--primary) 55%, transparent), 0 6px 18px -10px color-mix(in oklab, var(--chart-2) 60%, transparent)",
    "--shadow-md": "0 0 28px -6px color-mix(in oklab, var(--primary) 60%, transparent), 0 12px 30px -14px color-mix(in oklab, var(--chart-2) 70%, transparent)",
    "--shadow-lg": "0 0 48px -10px color-mix(in oklab, var(--primary) 65%, transparent), 0 20px 48px -18px color-mix(in oklab, var(--chart-2) 75%, transparent)",
    "--shadow-xl": "0 0 80px -14px color-mix(in oklab, var(--primary) 70%, transparent), 0 30px 70px -22px color-mix(in oklab, var(--chart-2) 80%, transparent)",
  },

  baseCss: `
  h1, h2, h3, h4 {
    font-family: var(--font-heading);
    font-weight: 400;
    letter-spacing: 0.02em;
    line-height: 1.08;
    text-transform: uppercase;
    text-wrap: balance;
  }
  /* By night the big headings are lit: a halo, and a hard edge of the second
     colour beneath, like chrome lettering catching the sunset. */
  .dark h1, .dark h2 {
    text-shadow: 0 0.05em 0 color-mix(in oklab, var(--chart-2) 85%, transparent), 0 0 1.4rem color-mix(in oklab, var(--primary) 70%, transparent);
  }
  ::selection { background: var(--primary); color: var(--primary-foreground); }
  /* The grid: a ruled floor tipped back to a horizon, fading as it recedes. */
  body::after {
    content: "";
    position: fixed;
    left: -50%;
    right: -50%;
    bottom: 0;
    height: 42vh;
    z-index: -1;
    pointer-events: none;
    background:
      linear-gradient(color-mix(in oklab, var(--primary) 70%, transparent) 2px, transparent 2px) 0 0 / 100% 3.5rem,
      linear-gradient(90deg, color-mix(in oklab, var(--primary) 70%, transparent) 2px, transparent 2px) 50% 0 / 3.5rem 100%;
    transform-origin: 50% 100%;
    transform: perspective(22rem) rotateX(58deg);
    -webkit-mask-image: linear-gradient(to top, black, transparent 90%);
    mask-image: linear-gradient(to top, black, transparent 90%);
    opacity: 0.42;
  }`,

  // The sky: the sun's glow coming down from the top, the accent rising from
  // the horizon to meet it.
  backdrop: `
      radial-gradient(46rem 26rem at 50% -8rem, color-mix(in oklab, var(--chart-2) 34%, transparent), transparent 70%),
      radial-gradient(70rem 28rem at 50% 108%, color-mix(in oklab, var(--primary) 32%, transparent), transparent 70%)`,

  skin: {
    controlHeight: "2.75rem",
    controlPadX: "1.5rem",
    controlRadius: "0.375rem",
    controlText: "0.75rem",
    borderWidth: "2px",
    buttonFont: "var(--font-heading)",
    buttonWeight: "400",
    buttonTracking: "0.08em",
    buttonCase: "uppercase",
    field: "outlined",
    fieldRadius: "0.375rem",
    fieldPadX: "0.875rem",
    cardRadius: "0.5rem",
    cardPad: "1.5rem",
    cardBorder: "1px solid color-mix(in oklab, var(--primary) 35%, var(--border))",
    cardShadow: "var(--shadow-sm)",
    cardTitleSize: "1.0625rem",
    cardTitleWeight: "400",
    cardTitleTracking: "0.03em",
    badgeRadius: "0.25rem",
    badgeFont: "var(--font-sans)",
    badgeCase: "uppercase",
    badgeTracking: "0.1em",
    badgeWeight: "700",
    badgeText: "0.625rem",
    badgePad: "0.25rem 0.625rem",
    tabs: "underline",
    tabsRadius: "0",
    overlayRadius: "0.5rem",
    overlayBorder: "1px solid color-mix(in oklab, var(--primary) 55%, var(--border))",
    overlayShadow: "var(--shadow-xl)",
    labelFont: "var(--font-sans)",
    labelCase: "uppercase",
    labelTracking: "0.12em",
    labelText: "0.6875rem",
    labelWeight: "700",
    checkRadius: "0.25rem",
    iconStroke: "2",
  },

  skinCss: `
  /* The sunset as a fill for anything of the app's own. */
  .bg-sunset { background-image: ${SUNSET}; color: var(--primary-foreground); }

  [data-slot="button"] { transition: box-shadow 200ms ease, transform 200ms ease, filter 200ms ease, background-color 200ms ease; }
  [data-slot="button"][data-variant="default"] {
    background-image: ${SUNSET};
    border-color: transparent;
    box-shadow: var(--shadow-sm);
  }
  [data-slot="button"][data-variant="default"]:hover { box-shadow: var(--shadow-md); transform: translateY(-1px); filter: brightness(1.08); }
  [data-slot="button"]:active { transform: scale(0.98); }
  [data-slot="button"][data-variant="outline"] { background: transparent; border-color: var(--primary); color: var(--primary); }
  [data-slot="button"][data-variant="outline"]:hover {
    background: color-mix(in oklab, var(--primary) 14%, transparent);
    box-shadow: var(--shadow-sm);
  }

  /* A panel has a strip of sunset along its top edge and a glow beneath it. */
  [data-slot="card"] {
    background-image: ${SUNSET};
    background-size: 100% 3px;
    background-repeat: no-repeat;
    transition: box-shadow 200ms ease, border-color 200ms ease;
  }
  [data-slot="card"]:hover { border-color: color-mix(in oklab, var(--primary) 70%, var(--border)); box-shadow: var(--shadow-md); }
  [data-slot="card-title"] { text-transform: uppercase; }
  [data-slot="card-footer"] { background: transparent; }

  [data-slot="input"], [data-slot="textarea"], [data-slot="select-trigger"] { background-color: color-mix(in oklab, var(--background) 60%, var(--card)); }
  [data-slot="input"]:focus-visible, [data-slot="textarea"]:focus-visible, [data-slot="select-trigger"]:focus-visible {
    border-color: var(--primary);
    box-shadow: var(--shadow-sm);
  }

  [data-slot="badge"] { background: transparent; border: 1px solid var(--border); color: var(--muted-foreground); }
  [data-slot="badge"][data-variant="default"] { background-image: ${SUNSET}; border-color: transparent; color: var(--primary-foreground); }
  [data-slot="badge"][data-variant="destructive"] { color: var(--destructive); border-color: currentColor; }

  ${TABS_TAB} { font-family: var(--font-heading); font-size: 0.75rem; letter-spacing: 0.08em; text-transform: uppercase; }
  ${TABS_TAB}[data-active] { color: var(--primary); border-bottom-color: var(--primary); }
  [data-slot="dialog-overlay"], [data-slot="alert-dialog-overlay"], [data-slot="sheet-overlay"] {
    background: color-mix(in oklab, var(--background) 70%, transparent);
    backdrop-filter: blur(8px);
  }`,

  layouts: [
    "poster",
    "split-hero",
    "full-bleed-bands",
    "bento",
    "focus-column",
    "topbar-workspace",
    "board",
    "dashboard-grid",
  ],

  prose: {
    overview:
      "This app is set at dusk in an imagined 1985: a deep violet night with a glow above and a neon grid running to the horizon below, both painted by the stylesheet. On it sit dark panels edged in colour, wide capital lettering that glows, and fills that run from the accent into the hue beside it. It should feel nostalgic, fast and cinematic.",
    colors:
      "Two colours, used together: the accent and its neighbour (`bg-chart-2`), which make the sunset. Use the pair as a gradient for what matters — the `bg-sunset` class gives it — and as glows. Text is near-white, secondary text a pale lilac. The other chart colours are for charts only.",
    typography:
      "Headings in the wide display face, uppercase and glowing; they can be very large. Buttons and tabs use it too, small and letterspaced. Everything else is a clean sans. Never set a paragraph in the display face.",
    layout:
      "Centre the scene: one big title in the sky, the action beneath it, the grid below. Keep the lower part of the first screen clear enough to see the horizon. Later sections can be bands and tiles.",
    elevation:
      "Depth is light. `shadow-xs` to `shadow-xl` are glows in the two sunset colours, the accent around a thing and its neighbour beneath it. Give them to what is live, selected or primary, and leave the rest dark.",
    shapes: "Crisp, only just rounded: 6px on controls, 8px on panels. Outlines are thin and coloured.",
    components: {
      button: "a block of sunset gradient with a wide uppercase label and a glow; the outline variant is a neon outline.",
      card: "a dark panel with a strip of sunset along its top edge and a glow that grows on hover.",
      input: "a dark outlined field that glows in the accent when focused.",
      badge: "a small squared uppercase tag; the default one is filled with the sunset.",
      tabs: "wide uppercase words in a row; the active one is the accent with a rule beneath.",
      dialog: "a dark panel outlined in the accent over a blurred night.",
    },
    icons: "Line icons at 20px. Give an icon the accent colour, or a `bg-sunset` tile of its own, when it marks something live.",
    dos: [
      "Use `bg-sunset` for one hero block, tile or bar per screen.",
      "Use dark, saturated imagery — night roads, city lights, palms — with text on a darkened part of it.",
      "Draw stripes, a banded sun or a horizon line with plain `div`s as decoration.",
      "Animate: things slide in, glows pulse slowly, buttons light up.",
    ],
    donts: [
      "Don't use the gradient on text, or on everything at once.",
      "Don't add more colours beyond the sunset pair outside of charts.",
      "Don't use it for dense tables or long forms.",
    ],
  },
};
