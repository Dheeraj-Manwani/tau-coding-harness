import type { StyleSpec } from "../types";
import { SANS_FALLBACK, SYSTEM_MONO, staticFont, variableFont } from "./fonts";
import { TABS_LIST, TABS_TAB } from "./selectors";

const SOLID_BUTTON = `[data-slot="button"]:not([data-variant="ghost"], [data-variant="link"])`;
const FIELDS = `[data-slot="input"], [data-slot="textarea"], [data-slot="select-trigger"]`;

/** The shine on a gel button: bright across the top half, then a hard line where it stops. */
const GLOSS =
  "linear-gradient(180deg, color-mix(in oklab, white 46%, transparent) 0%, color-mix(in oklab, white 12%, transparent) 46%, transparent 50%, color-mix(in oklab, black 10%, transparent) 100%)";

/** Brushed chrome. Its colours are fixed: chrome is chrome whatever the accent. */
const CHROME =
  "linear-gradient(180deg, #ffffff 0%, #d5d9e2 44%, #8e96a8 52%, #c9cfda 78%, #f4f6fa 100%)";
const CHROME_INK = "#16181f";

/** A die-cut sticker: a pale rim, a thin dark line round it, and a soft halo. */
const STICKER = "0 0 0 1.5px var(--y2k-ink), 0 12px 26px -10px var(--y2k-halo)";

export const y2k: StyleSpec = {
  key: "y2k",
  name: "Y2K",
  look: "The turn of the millennium: glossy gel buttons, chunky sticker lettering with a white rim, chrome, candy colours and soft blobs of colour over graph paper.",
  suits:
    "Fashion and streetwear drops, music and pop-culture fan sites, parties and club nights, youth brands, creator link pages, quizzes and social toys — anything loud, nostalgic and fun.",
  avoid: "Not for professional tools, finance, health, news, or anything that should feel calm, serious or timeless.",
  group: "loud",
  reach: "niche",
  aka: ["Y2K aesthetic"],

  fonts: {
    display: staticFont("Dela Gothic One", "dela-gothic-one", [400], SANS_FALLBACK),
    body: variableFont("Readex Pro", "readex-pro", SANS_FALLBACK),
    mono: SYSTEM_MONO,
  },
  // Each display face has one weight and is heavy at it; the base rules set
  // headings at 400 so none of them is faked bolder.
  fontOptions: [
    {
      key: "bagel",
      label: "Bagel Fat One + Quicksand",
      fonts: {
        display: staticFont("Bagel Fat One", "bagel-fat-one", [400], SANS_FALLBACK),
        body: variableFont("Quicksand", "quicksand", SANS_FALLBACK),
        mono: SYSTEM_MONO,
      },
    },
    {
      key: "bowlby",
      label: "Bowlby One + Sora",
      fonts: {
        display: staticFont("Bowlby One", "bowlby-one", [400], SANS_FALLBACK),
        body: variableFont("Sora", "sora", SANS_FALLBACK),
        mono: SYSTEM_MONO,
      },
    },
  ],
  defaultMode: "light",
  dials: { variance: 8, motion: 8, density: 4 },
  radius: "1rem",

  palette: {
    neutralHue: "accent",
    // Candy: the companions are far round the wheel and bright in both modes.
    chartHues: [150, -110, 60, 200],
    chartLightness: { light: [0.8, 0.76, 0.87, 0.74], dark: [0.8, 0.76, 0.87, 0.74] },
    light: {
      background: { l: 0.975, c: 0.012 },
      surface: { l: 1, c: 0 },
      foreground: { l: 0.2, c: 0.04 },
      muted: { l: 0.935, c: 0.025 },
      mutedForeground: { l: 0.45, c: 0.04 },
      border: { l: 0.82, c: 0.035 },
      primary: { l: 0.66, c: 0.24 },
      wash: { l: 0.92, c: 0.06 },
    },
    dark: {
      background: { l: 0.17, c: 0.04 },
      surface: { l: 0.235, c: 0.05 },
      foreground: { l: 0.97, c: 0.01 },
      muted: { l: 0.29, c: 0.05 },
      mutedForeground: { l: 0.81, c: 0.04 },
      border: { l: 0.42, c: 0.06 },
      primary: { l: 0.76, c: 0.2 },
      wash: { l: 0.33, c: 0.09 },
    },
  },

  theme: {
    "--shadow-2xs": "0 0 0 1px var(--y2k-ink)",
    "--shadow-xs": "0 0 0 1.5px var(--y2k-ink), 0 3px 8px -3px var(--y2k-halo)",
    "--shadow-sm": "0 0 0 1.5px var(--y2k-ink), 0 6px 14px -6px var(--y2k-halo)",
    "--shadow-md": STICKER,
    "--shadow-lg": "0 0 0 1.5px var(--y2k-ink), 0 20px 40px -14px var(--y2k-halo)",
    "--shadow-xl": "0 0 0 1.5px var(--y2k-ink), 0 30px 64px -18px var(--y2k-halo)",
  },

  baseCss: `
  /* The rim, the outline and the halo of a sticker. By night the halo is the accent. */
  html {
    --y2k-rim: #ffffff;
    --y2k-ink: var(--foreground);
    --y2k-halo: color-mix(in oklab, var(--foreground) 45%, transparent);
  }
  html.dark {
    --y2k-rim: color-mix(in oklab, white 88%, var(--primary));
    --y2k-ink: color-mix(in oklab, black 80%, var(--background));
    --y2k-halo: color-mix(in oklab, var(--primary) 55%, transparent);
  }
  h1, h2, h3, h4 {
    font-family: var(--font-heading);
    font-weight: 400;
    letter-spacing: -0.01em;
    line-height: 1;
    text-transform: uppercase;
    text-wrap: balance;
  }`,

  // Graph paper with three out-of-focus blobs of candy colour drifting over it.
  backdrop: `
      radial-gradient(34rem 26rem at 6% 0%, color-mix(in oklab, var(--chart-2) 40%, transparent), transparent 70%),
      radial-gradient(30rem 24rem at 100% 100%, color-mix(in oklab, var(--chart-3) 36%, transparent), transparent 70%),
      radial-gradient(26rem 20rem at 96% 4%, color-mix(in oklab, var(--primary) 28%, transparent), transparent 70%),
      linear-gradient(color-mix(in oklab, var(--foreground) 10%, transparent) 1px, transparent 1px) 0 0 / 3.5rem 3.5rem,
      linear-gradient(90deg, color-mix(in oklab, var(--foreground) 10%, transparent) 1px, transparent 1px) 0 0 / 3.5rem 3.5rem`,

  skin: {
    controlHeight: "2.75rem",
    controlPadX: "1.5rem",
    controlRadius: "9999px",
    controlText: "0.8125rem",
    borderWidth: "2px",
    buttonFont: "var(--font-heading)",
    buttonWeight: "400",
    buttonTracking: "0.02em",
    buttonCase: "uppercase",
    field: "outlined",
    fieldRadius: "1.25rem",
    fieldPadX: "1.125rem",
    cardRadius: "1.75rem",
    cardPad: "1.5rem",
    cardBorder: "3px solid var(--y2k-rim)",
    cardShadow: STICKER,
    cardTitleSize: "1.25rem",
    cardTitleWeight: "400",
    cardTitleTracking: "0",
    badgeRadius: "9999px",
    badgeFont: "var(--font-heading)",
    badgeCase: "uppercase",
    badgeTracking: "0.03em",
    badgeWeight: "400",
    badgeText: "0.6875rem",
    badgePad: "0.1875rem 0.75rem",
    tabs: "segmented",
    tabsRadius: "9999px",
    overlayRadius: "1.75rem",
    overlayBorder: "3px solid var(--y2k-rim)",
    overlayShadow: "0 0 0 1.5px var(--y2k-ink), 0 30px 64px -18px var(--y2k-halo)",
    labelFont: "var(--font-sans)",
    labelCase: "uppercase",
    labelTracking: "0.06em",
    labelText: "0.6875rem",
    labelWeight: "700",
    checkRadius: "0.5rem",
    iconStroke: "2.5",
  },

  skinCss: `
  /* Gel: a pill of colour with a wet shine across its top half. */
  ${SOLID_BUTTON} {
    background-image: ${GLOSS};
    border-color: color-mix(in oklab, black 22%, transparent);
    box-shadow: inset 0 -3px 6px 0 color-mix(in oklab, white 28%, transparent), 0 6px 14px -5px var(--y2k-halo);
    transition: transform 160ms cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 160ms ease, filter 160ms ease;
  }
  ${SOLID_BUTTON}:hover { transform: translateY(-2px) scale(1.03); filter: saturate(1.15) brightness(1.04); }
  ${SOLID_BUTTON}:active { transform: scale(0.96); filter: brightness(0.95); }
  [data-slot="button"][data-variant="default"] { text-shadow: 0 1px 0 color-mix(in oklab, white 35%, transparent); }
  [data-slot="button"][data-variant="default"]:hover { background-color: var(--primary); }
  [data-slot="button"][data-variant="outline"] { background-color: var(--card); color: var(--foreground); }
  [data-slot="button"][data-variant="secondary"] { background-image: ${CHROME}; color: ${CHROME_INK}; }

  /* A panel is a sticker: white rim, thin outline, soft halo, a faint sheen. */
  [data-slot="card"] {
    background-image: linear-gradient(135deg, color-mix(in oklab, var(--chart-2) 16%, transparent), transparent 42%, transparent 62%, color-mix(in oklab, var(--chart-3) 16%, transparent));
    transition: transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  a[data-slot="card"]:hover, button[data-slot="card"]:hover { transform: rotate(-1deg) scale(1.02); }
  [data-slot="card-title"] { text-transform: uppercase; }
  [data-slot="card-footer"] { background: transparent; border-top: 2px dashed var(--border); }

  ${FIELDS} {
    background-color: var(--card);
    border-color: var(--y2k-ink);
    box-shadow: inset 0 3px 5px 0 color-mix(in oklab, black 12%, transparent);
  }
  [data-slot="input"], [data-slot="select-trigger"] { border-radius: 9999px; }
  [data-slot="input"]:focus-visible, [data-slot="textarea"]:focus-visible, [data-slot="select-trigger"]:focus-visible {
    border-color: var(--y2k-ink);
    box-shadow: inset 0 3px 5px 0 color-mix(in oklab, black 12%, transparent), 0 0 0 4px color-mix(in oklab, var(--primary) 55%, transparent);
  }

  [data-slot="badge"] {
    background-image: ${GLOSS};
    border: 2px solid var(--y2k-rim);
    box-shadow: 0 0 0 1.5px var(--y2k-ink);
  }
  [data-slot="badge"][data-variant="secondary"], [data-slot="badge"][data-variant="outline"] {
    background-image: ${CHROME};
    color: ${CHROME_INK};
  }

  ${TABS_LIST} { background: var(--card); border: 2px solid var(--y2k-ink); }
  ${TABS_TAB}[data-active] {
    background-color: var(--primary);
    background-image: ${GLOSS};
    color: var(--primary-foreground);
    box-shadow: none;
  }
  [data-slot="checkbox"], [data-slot="switch"] { border-color: var(--y2k-ink); }
  [data-slot="dialog-overlay"], [data-slot="alert-dialog-overlay"], [data-slot="sheet-overlay"] {
    background: color-mix(in oklab, var(--primary) 22%, color-mix(in oklab, var(--background) 60%, transparent));
    backdrop-filter: blur(8px);
  }`,

  layouts: [
    "poster",
    "bento",
    "split-hero",
    "full-bleed-bands",
    "focus-column",
    "board",
    "topbar-workspace",
  ],

  prose: {
    overview:
      "This app is from the year 2000, on purpose. Buttons are glossy gel pills, panels are die-cut stickers with a white rim, headings are fat and uppercase, and blobs of candy colour float over graph paper behind it all. It should feel like a fan site or a club flyer made by someone having a very good time.",
    colors:
      "Several bright colours at once: the accent, and the chart colours (`bg-chart-2` to `bg-chart-5`) as its candy companions for stickers, tiles and tags, always under ink text. Chrome is the neutral: the secondary button and tag are brushed metal. White is the colour of rims and panels.",
    typography:
      "Headings, buttons and tags in one very heavy display face, uppercase and tightly set; make the main heading enormous and let it tilt. Text is a soft geometric sans. Small labels are uppercase and letterspaced. The voice is excited and short.",
    layout:
      "Collage, not grid: tilt things a few degrees each way (`-rotate-2`, `rotate-3`), overlap a sticker on the corner of a panel, let a heading run behind a picture. One big thing per screen, with small stickers scattered round it.",
    elevation:
      "Everything raised is a sticker: a thin dark outline and a soft halo, from `shadow-xs` to `shadow-xl`. Buttons shine instead. There are no flat cards and no plain grey drop shadows.",
    shapes: "Pills, bubbles and fat 28px corners. Stars, sparkles, flowers and smiley faces drawn as simple shapes are welcome as decoration.",
    components: {
      button: "a glossy gel pill in the accent with a heavy uppercase label; it bounces up on hover. The secondary variant is chrome.",
      card: "a white sticker: fat round corners, a pale rim, a thin dark outline, a soft halo and a faint two-colour sheen.",
      input: "a white pill with a dark outline and an inner shade; focus gives it a thick halo of the accent.",
      badge: "a small glossy pill with a pale rim; the secondary one is chrome.",
      tabs: "an outlined white pill tray; the active tab is a gel pill of the accent.",
      dialog: "a large sticker over a page washed in the accent.",
    },
    icons: "Thick rounded line icons at 20–24px, often in a gel circle of a chart colour (`rounded-full bg-chart-2 shadow-sm`).",
    dos: [
      "Tilt stickers, tags and pictures by a few degrees, in different directions.",
      "Use `shadow-md` on blocks of your own to turn them into stickers, and give them a `border-2 border-white` rim.",
      "Mix three or four of the candy colours on one screen.",
      "Make things wobble, bounce and spin a little when touched.",
    ],
    donts: [
      "Don't lay things out in a tidy, evenly spaced grid.",
      "Don't use muted, earthy or corporate colours, or thin elegant type.",
      "Don't set long paragraphs, or anything that has to be read carefully.",
    ],
  },
};
