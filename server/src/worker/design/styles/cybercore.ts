import type { StyleSpec } from "../types";
import { MONO_FALLBACK, SANS_FALLBACK, staticFont, variableFont } from "./fonts";

const mono = variableFont("Martian Mono", "martian-mono", MONO_FALLBACK);

const FIELDS = `[data-slot="input"], [data-slot="textarea"], [data-slot="select-trigger"]`;

export const cybercore: StyleSpec = {
  key: "cybercore",
  name: "Cybercore",
  look: "A technical specimen sheet: pale grey paper ruled with hairlines, a wide machine-drawn display face, tiny monospace annotations, corner marks on every panel, and one block of signal colour.",
  suits:
    "Design and architecture studios, tech and AI research projects, hardware and product specifications, techwear and fashion labels, portfolios, experimental music, catalogues and archives.",
  avoid: "Not for anything warm, friendly or for everyone — family, food, wellness, children — or for a shop that has to feel easy.",
  group: "tech",
  reach: "niche",

  fonts: {
    display: staticFont("Michroma", "michroma", [400], SANS_FALLBACK),
    body: variableFont("Familjen Grotesk", "familjen-grotesk", SANS_FALLBACK),
    mono,
  },
  // Each display face has one weight; the base rules set headings at 400.
  fontOptions: [
    {
      key: "zen-dots",
      label: "Zen Dots + Red Hat Text",
      fonts: {
        display: staticFont("Zen Dots", "zen-dots", [400], SANS_FALLBACK),
        body: variableFont("Red Hat Text", "red-hat-text", SANS_FALLBACK),
        mono,
      },
    },
    {
      key: "bruno",
      label: "Bruno Ace + Sora",
      fonts: {
        display: staticFont("Bruno Ace", "bruno-ace", [400], SANS_FALLBACK),
        body: variableFont("Sora", "sora", SANS_FALLBACK),
        mono,
      },
    },
  ],
  defaultMode: "light",
  dials: { variance: 7, motion: 4, density: 6 },
  radius: "0rem",

  palette: {
    // Drawing-office grey whatever the accent: the sheet is neutral and the
    // accent is the one thing on it with a colour.
    neutralHue: 250,
    chartHues: [180, 90, -90, 30],
    light: {
      background: { l: 0.925, c: 0.003 },
      surface: { l: 0.955, c: 0.003 },
      foreground: { l: 0.17, c: 0.005 },
      muted: { l: 0.895, c: 0.004 },
      mutedForeground: { l: 0.42, c: 0.006 },
      border: { l: 0.17, c: 0.005 },
      primary: { l: 0.6, c: 0.24 },
      wash: { l: 0.88, c: 0.05 },
    },
    dark: {
      background: { l: 0.15, c: 0.004 },
      surface: { l: 0.185, c: 0.004 },
      foreground: { l: 0.93, c: 0.004 },
      muted: { l: 0.225, c: 0.005 },
      mutedForeground: { l: 0.7, c: 0.006 },
      border: { l: 0.72, c: 0.005 },
      primary: { l: 0.72, c: 0.2 },
      wash: { l: 0.26, c: 0.05 },
    },
  },

  // No shadows. What lifts something off the sheet is a second frame drawn
  // round it, further out the more it matters.
  theme: {
    "--shadow-2xs": "none",
    "--shadow-xs": "none",
    "--shadow-sm": "0 0 0 2px var(--background), 0 0 0 3px var(--border)",
    "--shadow-md": "0 0 0 3px var(--background), 0 0 0 4px var(--border)",
    "--shadow-lg": "0 0 0 5px var(--background), 0 0 0 6px var(--border)",
    "--shadow-xl": "0 0 0 7px var(--background), 0 0 0 8px var(--border)",
    "--text-xs": "0.6875rem",
  },

  baseCss: `
  h1, h2, h3, h4 {
    font-family: var(--font-heading);
    font-weight: 400;
    letter-spacing: -0.01em;
    line-height: 1.12;
    text-wrap: balance;
  }
  ::selection { background: var(--primary); color: var(--primary-foreground); }`,

  // The sheet's ruling: a wide square grid in hairlines.
  backdrop: `
      linear-gradient(color-mix(in oklab, var(--foreground) 8%, transparent) 1px, transparent 1px) 0 0 / 6rem 6rem,
      linear-gradient(90deg, color-mix(in oklab, var(--foreground) 8%, transparent) 1px, transparent 1px) 0 0 / 6rem 6rem`,

  skin: {
    controlHeight: "2.5rem",
    controlPadX: "1.125rem",
    controlRadius: "0",
    controlText: "0.6875rem",
    borderWidth: "1px",
    buttonFont: "var(--font-mono)",
    buttonWeight: "500",
    buttonTracking: "0.08em",
    buttonCase: "uppercase",
    field: "outlined",
    fieldRadius: "0",
    fieldPadX: "0.75rem",
    cardRadius: "0",
    cardPad: "1.25rem",
    cardBorder: "1px solid var(--border)",
    cardShadow: "none",
    cardTitleSize: "0.9375rem",
    cardTitleWeight: "400",
    cardTitleTracking: "0",
    badgeRadius: "0",
    badgeFont: "var(--font-mono)",
    badgeCase: "uppercase",
    badgeTracking: "0.08em",
    badgeWeight: "500",
    badgeText: "0.625rem",
    badgePad: "0.1875rem 0.5rem",
    tabs: "boxed",
    tabsRadius: "0",
    overlayRadius: "0",
    overlayBorder: "1px solid var(--border)",
    overlayShadow: "var(--shadow-lg)",
    labelFont: "var(--font-mono)",
    labelCase: "uppercase",
    labelTracking: "0.1em",
    labelText: "0.625rem",
    labelWeight: "500",
    checkRadius: "0",
    iconStroke: "1.25",
  },

  skinCss: `
  /* Every panel carries registration marks: a heavy corner at the top left and
     the bottom right, the way a plate is marked for printing. */
  [data-slot="card"] { position: relative; }
  [data-slot="card"]::before, [data-slot="card"]::after {
    content: "";
    position: absolute;
    width: 0.625rem;
    height: 0.625rem;
    pointer-events: none;
  }
  [data-slot="card"]::before { top: -1px; left: -1px; border-top: 3px solid var(--foreground); border-left: 3px solid var(--foreground); }
  [data-slot="card"]::after { bottom: -1px; right: -1px; border-bottom: 3px solid var(--foreground); border-right: 3px solid var(--foreground); }
  [data-slot="card-footer"] { background: transparent; border-top: 1px solid var(--border); }

  /* The main button is the signal block; pressed or hovered, it goes to ink. */
  [data-slot="button"] { transition: background-color 100ms linear, color 100ms linear; }
  [data-slot="button"][data-variant="default"]:hover { background: var(--foreground); color: var(--background); }
  [data-slot="button"][data-variant="outline"], [data-slot="button"][data-variant="secondary"] {
    background: transparent;
    border-color: var(--border);
    color: var(--foreground);
  }
  [data-slot="button"][data-variant="outline"]:hover, [data-slot="button"][data-variant="secondary"]:hover {
    background: var(--foreground);
    color: var(--background);
  }
  [data-slot="button"][data-variant="link"] { color: var(--foreground); text-decoration: underline; text-underline-offset: 0.3em; }

  ${FIELDS} { background: var(--card); }
  [data-slot="input"]:focus-visible, [data-slot="textarea"]:focus-visible, [data-slot="select-trigger"]:focus-visible {
    border-color: var(--primary);
    box-shadow: 0 0 0 1px var(--primary);
  }

  [data-slot="badge"] { background: transparent; border: 1px solid currentColor; color: var(--foreground); }
  [data-slot="badge"][data-variant="default"] { background: var(--primary); border-color: var(--primary); color: var(--primary-foreground); }
  [data-slot="badge"][data-variant="secondary"] { color: var(--muted-foreground); }
  [data-slot="badge"][data-variant="destructive"] { color: var(--destructive); }

  [data-slot="table-row"] { border-color: var(--border); }
  [data-slot="separator"] { background: var(--border); }
  [data-slot="checkbox"], [data-slot="switch"] { border-color: var(--border); }
  [data-slot="dialog-overlay"], [data-slot="alert-dialog-overlay"], [data-slot="sheet-overlay"] {
    background: color-mix(in oklab, var(--background) 82%, transparent);
  }`,

  layouts: [
    "index-list",
    "poster",
    "bento",
    "split-hero",
    "dashboard-grid",
    "master-detail",
    "split-tool",
    "sidebar-shell",
  ],

  prose: {
    overview:
      "This app is laid out like a technical sheet — a specimen, a blueprint. Pale grey paper ruled with a faint grid, thin black lines dividing it into cells, a wide machine-like face for names, and small monospace notes on everything. One block of strong colour marks what matters. It should feel exact, cold and a little cryptic.",
    colors:
      "Grey paper, black ink, and one signal colour. The accent is used as a solid block — the main button, one tile, one tag — never as a tint, a glow or a gradient, and at most twice on a screen. Everything else is ink and paper. Photographs are black and white, high in contrast.",
    typography:
      "Three voices. Names and headings in the wide display face at regular weight; set the main one large and in lowercase. Sentences in a plain grotesk. Everything functional — buttons, labels, tags, captions, dates, counts — in small uppercase monospace. Annotate freely: `FIG. 02`, `REV 2024`, `/ index`.",
    layout:
      "Divide the screen into ruled cells that share their borders, like a form or a drawing's title block, and let cells be very different sizes. Leave some nearly empty, with only a small label in a corner. Put metadata at the edges: top bar, bottom strip, side column.",
    elevation:
      "None. The shadow utilities draw a second hairline frame round a thing instead, further out as they grow (`shadow-sm` to `shadow-xl`): use one for the item that is selected or open.",
    shapes: "Square corners and one-pixel ink lines throughout. Small crosses, circles, arrows and hatching made of lines are the only decoration.",
    components: {
      button: "a small square block with an uppercase monospace label; the main one is the accent and turns ink on hover, the others are hairline frames.",
      card: "a square hairline cell with a heavy registration mark at two opposite corners.",
      input: "a square hairline field that takes an accent outline when focused.",
      badge: "a tiny hairline tag in uppercase monospace; the default one is a block of the accent.",
      tabs: "adjoining hairline cells; the active one is filled with ink.",
      dialog: "a square sheet inside a double hairline frame.",
    },
    icons: "Very thin line icons at 16px. Plain characters do as well: `+`, `×`, `→`, `/`, `*`.",
    dos: [
      "Label everything with small monospace annotations: an index number, a date, a unit, a status.",
      "Share borders between neighbouring cells (`border-l`, `border-t`) instead of leaving gaps.",
      "Make one cell per screen a solid block of the accent.",
    ],
    donts: [
      "Don't round corners, add shadows or use gradients.",
      "Don't tint things with the accent or use it for text; it is a block or it is absent.",
      "Don't centre everything; pin content to the corners and edges of its cell.",
      "Don't write warm, chatty copy; labels are terse and factual.",
    ],
  },
};
