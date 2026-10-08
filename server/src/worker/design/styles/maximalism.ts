import type { StyleSpec } from "../types";
import { SANS_FALLBACK, SYSTEM_MONO, staticFont, variableFont } from "./fonts";
import { TABS_TAB } from "./selectors";

/**
 * Maximalism: more is more. Pattern on the page, colour next to its opposite,
 * thick outlines and hard coloured shadows, a heavy display face, labels like
 * stickers. The discipline is in how it is done: the busy things are the page
 * and the decoration, never the text, and each panel is plain enough inside to
 * be read. The artwork is generated (`StyleSpec.art`) and is as crowded as the
 * page.
 */
export const maximalism: StyleSpec = {
  key: "maximalism",
  name: "Maximalism",
  look: "Joyful excess: patterns on the page, saturated colours side by side, thick outlines with hard coloured shadows, a heavy display face and stickers on everything, with every panel plain enough inside to read.",
  suits:
    "Fashion and festivals, a toy or a candy brand, a party or an event, a creative agency, a record label, a zine, a children's or a youth brand, anything that wants to be loud, warm and a little too much.",
  avoid: "Not for finance, health, legal or any tool people must read for long, and not for anything that should feel calm or premium.",
  group: "loud",
  reach: "niche",
  aka: ["Maximalist", "More is more"],
  art: "A maximalist collage: dense, saturated, layered pattern and ornament, clashing bold colours, many objects crowded into the frame, rich textures, flowers, fabrics and fruit, a joyful excess with nothing left empty",

  fonts: {
    display: staticFont("Bowlby One", "bowlby-one", [400], SANS_FALLBACK),
    body: variableFont("Schibsted Grotesk", "schibsted-grotesk", SANS_FALLBACK),
    mono: SYSTEM_MONO,
  },
  fontOptions: [
    {
      key: "bagel",
      label: "Bagel Fat One + Figtree",
      fonts: {
        display: staticFont("Bagel Fat One", "bagel-fat-one", [400], SANS_FALLBACK),
        body: variableFont("Figtree", "figtree", SANS_FALLBACK),
        mono: SYSTEM_MONO,
      },
    },
    {
      key: "unbounded",
      label: "Unbounded + Lexend",
      fonts: {
        display: variableFont("Unbounded", "unbounded", SANS_FALLBACK),
        body: variableFont("Lexend", "lexend", SANS_FALLBACK),
        mono: SYSTEM_MONO,
      },
    },
  ],
  defaultMode: "light",
  dials: { variance: 9, motion: 7, density: 7 },
  radius: "1rem",

  palette: {
    neutralHue: "accent",
    // Colours that fight politely: the accent's near neighbours and its opposite.
    chartHues: [120, 180, 240, 300],
    chartLightness: {
      light: [0.78, 0.8, 0.72, 0.84],
      dark: [0.78, 0.8, 0.72, 0.84],
    },
    fencedPrimary: true,
    light: {
      background: { l: 0.965, c: 0.05 },
      surface: { l: 0.99, c: 0.02 },
      foreground: { l: 0.2, c: 0.06 },
      muted: { l: 0.93, c: 0.06 },
      mutedForeground: { l: 0.42, c: 0.06 },
      border: { l: 0.2, c: 0.06 },
      primary: { l: 0.6, c: 0.24 },
      wash: { l: 0.92, c: 0.09 },
    },
    dark: {
      background: { l: 0.22, c: 0.07 },
      surface: { l: 0.28, c: 0.07 },
      foreground: { l: 0.96, c: 0.03 },
      muted: { l: 0.33, c: 0.08 },
      mutedForeground: { l: 0.78, c: 0.06 },
      border: { l: 0.96, c: 0.03 },
      primary: { l: 0.74, c: 0.2 },
      wash: { l: 0.36, c: 0.1 },
    },
  },

  theme: {
    "--text-base": "1rem",
    "--text-base--line-height": "1.55",
    "--shadow-2xs": "none",
    "--shadow-xs": "2px 2px 0 0 var(--foreground)",
    "--shadow-sm": "4px 4px 0 0 var(--foreground)",
    "--shadow-md": "6px 6px 0 0 var(--chart-1)",
    "--shadow-lg": "10px 10px 0 0 var(--chart-2)",
    "--shadow-xl": "14px 14px 0 0 var(--chart-3)",
  },

  baseCss: `
  h1, h2, h3, h4 {
    font-family: var(--font-heading);
    font-weight: 400;
    letter-spacing: -0.01em;
    line-height: 1;
    text-wrap: balance;
  }
  h1 { text-transform: uppercase; }
  p { text-wrap: pretty; }`,

  // Stripes and polka dots, big and soft, so there is pattern everywhere and none of it under a word.
  backdrop: `
      radial-gradient(color-mix(in oklab, var(--chart-1) 36%, transparent) 2.2px, transparent 2.6px) 0 0 / 1.75rem 1.75rem,
      repeating-linear-gradient(135deg, color-mix(in oklab, var(--chart-2) 14%, transparent) 0 1.1rem, transparent 1.1rem 2.2rem)`,

  skin: {
    controlHeight: "3rem",
    controlPadX: "1.5rem",
    controlRadius: "9999px",
    controlText: "0.9375rem",
    borderWidth: "3px",
    buttonFont: "var(--font-heading)",
    buttonWeight: "400",
    buttonTracking: "0.02em",
    buttonCase: "uppercase",
    field: "outlined",
    fieldRadius: "1rem",
    fieldPadX: "1.125rem",
    cardRadius: "1.25rem",
    cardPad: "1.5rem",
    cardBorder: "3px solid var(--foreground)",
    cardShadow: "var(--shadow-md)",
    cardTitleSize: "1.5rem",
    cardTitleWeight: "400",
    cardTitleTracking: "0",
    badgeRadius: "9999px",
    badgeFont: "var(--font-heading)",
    badgeCase: "uppercase",
    badgeTracking: "0.04em",
    badgeWeight: "400",
    badgeText: "0.75rem",
    badgePad: "0.25rem 0.75rem",
    tabs: "boxed",
    tabsRadius: "0",
    overlayRadius: "1.25rem",
    overlayBorder: "3px solid var(--foreground)",
    overlayShadow: "var(--shadow-xl)",
    labelFont: "var(--font-heading)",
    labelCase: "uppercase",
    labelTracking: "0.04em",
    labelText: "0.8125rem",
    labelWeight: "400",
    checkRadius: "0.375rem",
    iconStroke: "2.5",
    iconSize: "1.5rem",
  },

  skinCss: `
  [data-slot="button"] { transition: transform 140ms ease, box-shadow 140ms ease; }
  [data-slot="button"][data-variant="default"] { box-shadow: 4px 4px 0 0 var(--foreground); }
  [data-slot="button"][data-variant="default"]:hover { transform: translate(-2px, -2px) rotate(-1deg); box-shadow: 6px 6px 0 0 var(--foreground); }
  [data-slot="button"][data-variant="default"]:active { transform: translate(3px, 3px); box-shadow: none; }
  [data-slot="button"][data-variant="outline"] { background: var(--chart-1); color: var(--foreground); border-color: var(--foreground); }
  [data-slot="button"][data-variant="secondary"] { background: var(--chart-2); color: var(--foreground); border: var(--border-w) solid var(--foreground); }

  /* A panel is plain inside and loud outside. Each in a row takes the next colour of the set. */
  [data-slot="card"] { background: var(--card); }
  [data-slot="card"]:nth-of-type(3n + 2) { box-shadow: var(--shadow-lg); }
  [data-slot="card"]:nth-of-type(3n) { box-shadow: var(--shadow-xl); }
  [data-slot="card-title"] { font-family: var(--font-heading); text-transform: uppercase; }
  [data-slot="card-footer"] { background: transparent; border-top: 3px solid var(--foreground); }

  /* Badges are stickers: a colour, a heavy outline, a little tilt. */
  [data-slot="badge"] { background: var(--chart-3); color: var(--foreground); border: 2px solid var(--foreground); transform: rotate(-2deg); }
  [data-slot="badge"][data-variant="default"] { background: var(--primary); color: var(--primary-foreground); }
  ${TABS_TAB}[data-active] { background: var(--chart-2); color: var(--foreground); }`,

  layouts: [
    "bento",
    "poster",
    "split-hero",
    "full-bleed-bands",
    "index-list",
    "focus-column",
    "topbar-workspace",
  ],

  prose: {
    overview:
      "This app is a party that has been going a while. There is colour everywhere, pattern on the page, stickers and thick outlines and hard coloured shadows, and the headlines are enormous. It should be joyful and a little too much, and still easy to read, because the busy part is the decoration and never the text.",
    colors:
      "Saturated colours side by side — the accent, its neighbours and its opposite — on a warm page, with near-black outlines and text. The page carries the pattern; panels are plain and light inside, so text always sits on a clean ground. Use the chart colours for stickers, shadows and fills; keep the accent for the main action.",
    typography:
      "Headings in the heavy display face, uppercase and enormous, tight, one word often set larger than the rest. Text in a clean sans at a comfortable size. Labels and buttons are the display face, small, uppercase.",
    layout:
      "Crowd the page with intent. A bento of tiles of different sizes and colours, with a sticker on one, a big word across another, and a picture breaking out of its frame. Let things overlap and tilt a degree or two. Fill the space, but give every block one clear thing to say.",
    elevation:
      "Hard, flat, coloured shadows: a solid block offset to the lower right, never a blur. Panels sit on a block of one chart colour; the next one on another.",
    shapes:
      "Pills for buttons and stickers, big rounded corners on panels, and a thick near-black outline on everything: 3px.",
    components: {
      button: "a pill with a thick outline and a hard shadow that it presses flat into, tilting a little when pointed at.",
      card: "a plain light panel in a thick outline, with a hard coloured block for a shadow and an uppercase title.",
      input: "a rounded field with a thick outline.",
      badge: "a sticker: a coloured pill with a heavy outline, tilted.",
      tabs: "a row of boxed cells joined by thick outlines, the active one in colour.",
      dialog: "a rounded sheet with a thick outline and a big coloured shadow.",
    },
    icons: "Heavy line icons at 24px, often inside a coloured circle with an outline like a sticker.",
    dos: [
      "Make the artwork with `generate_image`: crowded, saturated collage, and use it big.",
      "Put a sticker, a starburst or a tilted label on the main thing on each screen.",
      "Use at least three colours on a screen, and one word set much larger than the rest.",
      "Keep text on plain light panels so it can always be read.",
    ],
    donts: [
      "Don't put text over a pattern or a busy picture.",
      "Don't use soft shadows, glass, gradients or pale colours.",
      "Don't leave a large area empty and plain.",
      "Don't let the decoration hide what a button does.",
    ],
  },
};
