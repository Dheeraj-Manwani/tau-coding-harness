import type { StyleSpec } from "../types";
import { SANS_FALLBACK, SYSTEM_MONO, variableFont } from "./fonts";
import { TABS_TAB } from "./selectors";

export const minimal: StyleSpec = {
  key: "minimal",
  name: "Minimal",
  look: "Almost nothing, placed exactly: a white page, near-black type in one quiet grotesk, small pill controls, no borders or shadows, and the accent used once.",
  suits:
    "Portfolios, studios, single-product pages, personal sites, galleries and collections, writing and reading tools, calm utilities — anything where the content is the design.",
  avoid: "Not for dense dashboards and data-heavy tools, or for anything that should feel loud, cosy or decorated.",
  group: "precise",
  aka: ["Minimalism"],

  fonts: {
    display: variableFont("Wix Madefor Display", "wix-madefor-display", SANS_FALLBACK),
    body: variableFont("Wix Madefor Text", "wix-madefor-text", SANS_FALLBACK),
    mono: SYSTEM_MONO,
  },
  fontOptions: [
    {
      key: "mona",
      label: "Mona Sans",
      fonts: {
        display: variableFont("Mona Sans", "mona-sans", SANS_FALLBACK),
        body: variableFont("Mona Sans", "mona-sans", SANS_FALLBACK),
        mono: SYSTEM_MONO,
      },
    },
    {
      key: "rethink",
      label: "Rethink Sans",
      fonts: {
        display: variableFont("Rethink Sans", "rethink-sans", SANS_FALLBACK),
        body: variableFont("Rethink Sans", "rethink-sans", SANS_FALLBACK),
        mono: SYSTEM_MONO,
      },
    },
  ],
  defaultMode: "light",
  dials: { variance: 4, motion: 3, density: 2 },
  radius: "0.5rem",

  palette: {
    neutralHue: "accent",
    chartHues: [30, -30, 180, 150],
    light: {
      background: { l: 1, c: 0 },
      // Panels are a breath of grey, not a box: there is no border to draw them.
      surface: { l: 0.972, c: 0.002 },
      foreground: { l: 0.17, c: 0.004 },
      muted: { l: 0.955, c: 0.002 },
      mutedForeground: { l: 0.5, c: 0.004 },
      border: { l: 0.91, c: 0.002 },
      primary: { l: 0.52, c: 0.2 },
      wash: { l: 0.96, c: 0.02 },
    },
    dark: {
      background: { l: 0.13, c: 0 },
      surface: { l: 0.175, c: 0.002 },
      foreground: { l: 0.96, c: 0.002 },
      muted: { l: 0.205, c: 0.002 },
      mutedForeground: { l: 0.68, c: 0.004 },
      border: { l: 0.27, c: 0.003 },
      primary: { l: 0.72, c: 0.17 },
      wash: { l: 0.23, c: 0.03 },
    },
  },

  theme: {
    "--shadow-2xs": "none",
    "--shadow-xs": "none",
    "--shadow-sm": "none",
    "--shadow-md": "none",
    "--shadow-lg": "0 20px 50px -24px rgb(0 0 0 / 0.22)",
    "--shadow-xl": "0 32px 80px -32px rgb(0 0 0 / 0.3)",
  },

  baseCss: `
  h1, h2, h3, h4 {
    font-family: var(--font-heading);
    font-weight: 500;
    letter-spacing: -0.03em;
    line-height: 1.08;
    text-wrap: balance;
  }
  ::selection { background: var(--foreground); color: var(--background); }`,

  skin: {
    controlHeight: "2.25rem",
    controlPadX: "1.125rem",
    controlRadius: "9999px",
    controlText: "0.8125rem",
    borderWidth: "1px",
    buttonFont: "var(--font-sans)",
    buttonWeight: "500",
    buttonTracking: "0",
    buttonCase: "none",
    field: "filled",
    fieldRadius: "0.5rem",
    fieldPadX: "0.875rem",
    cardRadius: "0.75rem",
    cardPad: "1.5rem",
    cardBorder: "0",
    cardShadow: "none",
    cardTitleSize: "1rem",
    cardTitleWeight: "500",
    cardTitleTracking: "-0.015em",
    badgeRadius: "9999px",
    badgeFont: "var(--font-sans)",
    badgeCase: "none",
    badgeTracking: "0",
    badgeWeight: "500",
    badgeText: "0.6875rem",
    badgePad: "0.125rem 0.5rem",
    tabs: "underline",
    tabsRadius: "0",
    overlayRadius: "0.75rem",
    overlayBorder: "1px solid var(--border)",
    overlayShadow: "var(--shadow-lg)",
    labelFont: "var(--font-sans)",
    labelCase: "none",
    labelTracking: "0",
    labelText: "0.8125rem",
    labelWeight: "500",
    checkRadius: "0.25rem",
    iconStroke: "1.5",
  },

  skinCss: `
  /* The main button is ink, not colour: the accent is kept for the one small
     thing per screen that should be noticed. */
  [data-slot="button"] { transition: background-color 140ms ease, color 140ms ease, opacity 140ms ease; }
  [data-slot="button"][data-variant="default"] { background: var(--foreground); color: var(--background); }
  [data-slot="button"][data-variant="default"]:hover { background: color-mix(in oklab, var(--foreground) 82%, var(--background)); }
  [data-slot="button"][data-variant="outline"] { background: transparent; border-color: var(--border); }
  [data-slot="button"][data-variant="outline"]:hover { background: var(--muted); }
  [data-slot="button"][data-variant="link"] { color: var(--foreground); text-decoration: underline; text-underline-offset: 0.25em; }

  [data-slot="card-footer"] { background: transparent; border-top: 0; }

  /* A tag is a grey pill with a dot of the accent in it. */
  [data-slot="badge"] { background: var(--muted); color: var(--foreground); border-color: transparent; }
  [data-slot="badge"][data-variant="default"]::before {
    content: "";
    width: 0.375rem;
    height: 0.375rem;
    border-radius: 9999px;
    background: var(--primary);
  }
  [data-slot="badge"][data-variant="outline"] { background: transparent; border-color: var(--border); }
  [data-slot="badge"][data-variant="destructive"] { color: var(--destructive); }

  [data-slot="input"]:focus-visible, [data-slot="textarea"]:focus-visible, [data-slot="select-trigger"]:focus-visible {
    border-color: var(--foreground);
    box-shadow: none;
  }
  ${TABS_TAB} { color: var(--muted-foreground); }
  [data-slot="dialog-overlay"], [data-slot="alert-dialog-overlay"], [data-slot="sheet-overlay"] {
    background: color-mix(in oklab, var(--background) 78%, transparent);
    backdrop-filter: blur(4px);
  }`,

  layouts: [
    "split-hero",
    "editorial-column",
    "index-list",
    "poster",
    "focus-column",
    "topbar-workspace",
    "master-detail",
    "split-tool",
  ],

  prose: {
    overview:
      "This app is as plain as it can be made and still be complete. A white page, near-black text in one grotesk, and room around everything; nothing is boxed, shaded or decorated. What is left has to be exactly right: the wording, the alignment, the one image. It should feel calm and sure of itself.",
    colors:
      "Black on white, with greys for whatever matters less. The accent appears once per screen, small — a dot in a tag, a link, the checked state of a control, one figure — and never as a filled block. The main button is ink, not accent. If a screen looks fine with the accent removed, it is right.",
    typography:
      "One grotesk at medium weight for headings and regular for text; no bold, no uppercase, no letterspacing. Make hierarchy with size and with space, in two or three steps only. Headings are tight and can be large; text lines are short.",
    layout:
      "Fewer things, further apart. Give each screen one subject and leave the rest of it empty. Align everything to one or two vertical lines. Separate sections with space alone — `py-24` or more on a page — not with rules, boxes or background bands.",
    elevation:
      "None. Nothing floats and nothing casts a shadow, except a menu or dialog while it is open (`shadow-lg`). A panel is a slightly greyer rectangle on the page, not a raised card.",
    shapes: "Pills for buttons and tags, 12px corners on panels, 8px on fields. No borders on panels; a hairline only where a line is needed to read a table or a list.",
    components: {
      button: "a small ink pill with a plain label; the outline variant is a hairline pill.",
      card: "a borderless, shadowless panel a shade greyer than the page.",
      input: "a quiet grey field with no border until it is focused, when it gains an ink hairline.",
      badge: "a small grey pill; the default one carries a dot of the accent.",
      tabs: "grey words in a row; the active one turns ink with a rule beneath.",
      dialog: "a plain white sheet with a hairline edge, over a faded page.",
    },
    icons: "Thin line icons at 16–18px, in the text colour, and only where a word would not do.",
    dos: [
      "Leave most of each screen empty, and put the one important thing where the eye lands first.",
      "Use one large, well-chosen image instead of several small ones.",
      "Write short: a heading, one sentence, one action.",
      "Line up every left edge with another left edge.",
    ],
    donts: [
      "Don't put content in bordered or shadowed cards; set it on the page.",
      "Don't fill a button, a band or a panel with the accent.",
      "Don't add icons, dividers, badges or illustrations as decoration.",
      "Don't use more than three text sizes on a screen, or bold for emphasis.",
    ],
  },
};
