import type { StyleSpec } from "../types";
import { MONO_FALLBACK, staticFont, variableFont } from "./fonts";

const sometype = variableFont("Sometype Mono", "sometype-mono", MONO_FALLBACK);
const dmMono = staticFont("DM Mono", "dm-mono", [400, 500], MONO_FALLBACK);
const chivoMono = variableFont("Chivo Mono", "chivo-mono", MONO_FALLBACK);

const SOLID_BUTTON = `[data-slot="button"]:not([data-variant="ghost"], [data-variant="link"])`;
const FIELDS = `[data-slot="input"], [data-slot="textarea"], [data-slot="select-trigger"]`;
const OVERLAYS = `[data-slot="dialog-content"], [data-slot="alert-dialog-content"], [data-slot="popover-content"],
  [data-slot="dropdown-menu-content"], [data-slot="select-content"], [data-slot="sheet-content"]`;

/**
 * An outline with its four corner pixels missing, which is what makes a box
 * read as drawn on a grid rather than as a square with a border.
 *
 * Painted as four bars in the border area, each stopping one pixel short of
 * the corners, over a transparent border. Done with backgrounds rather than a
 * clip path so nothing is cut off: a shadow, a focus ring or a sticker
 * hanging over the edge all still show. The last, empty layer is there to
 * carry `padding-box`, which is the clip the background colour takes — so a
 * fill from any class (`bg-card`, `bg-primary`, `bg-chart-3`) still works and
 * stays out of the corners.
 */
const PIXEL_EDGE = `
    border-color: transparent;
    background-image:
      linear-gradient(var(--px-ink), var(--px-ink)),
      linear-gradient(var(--px-ink), var(--px-ink)),
      linear-gradient(var(--px-ink), var(--px-ink)),
      linear-gradient(var(--px-ink), var(--px-ink)),
      linear-gradient(transparent, transparent);
    background-position: center top, center bottom, left center, right center, center;
    background-size:
      calc(100% - 2 * var(--px)) var(--px), calc(100% - 2 * var(--px)) var(--px),
      var(--px) calc(100% - 2 * var(--px)), var(--px) calc(100% - 2 * var(--px)), auto;
    background-repeat: no-repeat;
    background-origin: border-box;
    background-clip: border-box, border-box, border-box, border-box, padding-box;`;

/** A bevel one pixel wide: lit along the top and left, shaded along the bottom and right. */
const BEVEL = "inset calc(-1 * var(--px)) calc(-1 * var(--px)) 0 0 var(--px-lo), inset var(--px) var(--px) 0 0 var(--px-hi)";
const BEVEL_PRESSED = "inset var(--px) var(--px) 0 0 var(--px-lo)";

export const pixel: StyleSpec = {
  key: "pixel",
  name: "Pixel",
  look: "An 8-bit game screen: chunky pixel lettering, boxes with stepped corners and one-pixel bevels, hard two-tone shadows, flat saturated colour and monospace captions.",
  suits:
    "Games and game-adjacent sites, arcades and leaderboards, retro and indie brands, creative studios with a sense of humour, quizzes, hobby projects, event pages — anything that wants nostalgia and a wink.",
  avoid: "Not for long reading, professional or financial tools, health, or anything that has to look serious or refined.",
  group: "loud",
  aka: ["Pixel art", "8-bit"],

  fonts: {
    display: variableFont("Pixelify Sans", "pixelify-sans", MONO_FALLBACK),
    body: sometype,
    mono: sometype,
  },
  fontOptions: [
    {
      key: "silkscreen",
      label: "Silkscreen + DM Mono",
      fonts: {
        display: staticFont("Silkscreen", "silkscreen", [400, 700], MONO_FALLBACK),
        body: dmMono,
        mono: dmMono,
      },
    },
    {
      key: "handjet",
      label: "Handjet + Chivo Mono",
      fonts: {
        display: variableFont("Handjet", "handjet", MONO_FALLBACK),
        body: chivoMono,
        mono: chivoMono,
      },
    },
  ],
  defaultMode: "light",
  dials: { variance: 6, motion: 6, density: 5 },
  radius: "0rem",

  palette: {
    neutralHue: "accent",
    // Every fill is fenced by the ink outline, so a bright accent stays bright.
    fencedPrimary: true,
    // A sprite sheet's worth of colours, far apart and bright enough for ink text.
    chartHues: [120, -90, 60, 180],
    chartLightness: { light: [0.78, 0.74, 0.86, 0.72], dark: [0.8, 0.76, 0.86, 0.74] },
    light: {
      background: { l: 0.965, c: 0.012 },
      surface: { l: 1, c: 0 },
      foreground: { l: 0.16, c: 0.02 },
      muted: { l: 0.92, c: 0.02 },
      mutedForeground: { l: 0.42, c: 0.02 },
      border: { l: 0.16, c: 0.02 },
      primary: { l: 0.62, c: 0.24 },
      wash: { l: 0.9, c: 0.07 },
    },
    dark: {
      background: { l: 0.16, c: 0.03 },
      surface: { l: 0.215, c: 0.035 },
      foreground: { l: 0.97, c: 0.01 },
      muted: { l: 0.275, c: 0.04 },
      mutedForeground: { l: 0.78, c: 0.03 },
      border: { l: 0.97, c: 0.01 },
      primary: { l: 0.78, c: 0.19 },
      wash: { l: 0.32, c: 0.08 },
    },
  },

  theme: {
    "--shadow-2xs": "2px 2px 0 0 var(--px-shade)",
    "--shadow-xs": "2px 2px 0 0 var(--px-shade)",
    "--shadow-sm": "4px 4px 0 0 var(--px-shade)",
    "--shadow-md": "8px 8px 0 0 var(--px-shade)",
    "--shadow-lg": "12px 12px 0 0 var(--px-shade)",
    "--shadow-xl": "16px 16px 0 0 var(--px-shade)",
  },

  baseCss: `
  /* One pixel of this screen, the ink it is outlined in, and the two tones of
     a bevel and a shadow. */
  html {
    --px: 4px;
    --px-ink: var(--border);
    --px-hi: color-mix(in oklab, white 38%, transparent);
    --px-lo: color-mix(in oklab, black 24%, transparent);
    --px-shade: color-mix(in oklab, var(--foreground) 24%, transparent);
  }
  html.dark {
    --px-hi: color-mix(in oklab, white 22%, transparent);
    --px-lo: color-mix(in oklab, black 40%, transparent);
    --px-shade: color-mix(in oklab, black 75%, transparent);
  }
  h1, h2, h3, h4 {
    font-family: var(--font-heading);
    font-weight: 700;
    letter-spacing: 0;
    line-height: 1;
    text-transform: uppercase;
  }
  ::selection { background: var(--primary); color: var(--primary-foreground); }`,

  skin: {
    controlHeight: "2.75rem",
    controlPadX: "1.25rem",
    controlRadius: "0",
    controlText: "1rem",
    borderWidth: "4px",
    buttonFont: "var(--font-heading)",
    buttonWeight: "600",
    buttonTracking: "0.02em",
    buttonCase: "uppercase",
    field: "outlined",
    fieldRadius: "0",
    fieldPadX: "0.75rem",
    cardRadius: "0",
    cardPad: "1.5rem",
    cardBorder: "4px solid transparent",
    cardShadow: "8px 8px 0 0 var(--px-shade)",
    cardTitleSize: "1.375rem",
    cardTitleWeight: "700",
    cardTitleTracking: "0.01em",
    badgeRadius: "0",
    badgeFont: "var(--font-heading)",
    badgeCase: "uppercase",
    badgeTracking: "0.04em",
    badgeWeight: "600",
    badgeText: "0.8125rem",
    badgePad: "0 0.5rem",
    tabs: "boxed",
    tabsRadius: "0",
    overlayRadius: "0",
    overlayBorder: "4px solid transparent",
    overlayShadow: "12px 12px 0 0 var(--px-shade)",
    labelFont: "var(--font-mono)",
    labelCase: "uppercase",
    labelTracking: "0.06em",
    labelText: "0.75rem",
    labelWeight: "500",
    checkRadius: "0",
    iconStroke: "2.5",
  },

  skinCss: `
  /* Icons are drawn with square pen strokes, like everything else. */
  .lucide { stroke-linecap: square; stroke-linejoin: miter; }

  ${SOLID_BUTTON}, [data-slot="card"], ${FIELDS}, [data-slot="badge"], [data-slot="checkbox"],
  ${OVERLAYS} {${PIXEL_EDGE}
  }

  /* A button is a bevelled key. It moves in whole pixels, with no easing. */
  ${SOLID_BUTTON} { box-shadow: ${BEVEL}; transition: transform 80ms steps(2); }
  ${SOLID_BUTTON}:hover { transform: translate(0, calc(-1 * var(--px))); }
  ${SOLID_BUTTON}:active { transform: translate(0, 0); box-shadow: ${BEVEL_PRESSED}; }
  [data-slot="button"][data-variant="default"]:hover { background-color: var(--primary); }
  [data-slot="button"][data-variant="outline"] { background-color: var(--card); }
  [data-slot="button"][data-variant="outline"]:hover { background-color: var(--accent); }
  [data-slot="button"][data-variant="secondary"] { background-color: var(--foreground); color: var(--background); }
  [data-slot="button"][data-variant="link"] { color: var(--foreground); text-decoration: underline; text-decoration-thickness: 2px; }
  [data-slot="button"]:focus-visible { outline: var(--px) solid var(--ring); outline-offset: var(--px); }

  [data-slot="card-title"] { text-transform: uppercase; }
  [data-slot="card-footer"] { background: var(--muted); border-top: var(--px) solid var(--px-ink); }

  ${FIELDS} { background-color: var(--card); box-shadow: inset var(--px) var(--px) 0 0 var(--px-lo); }
  [data-slot="input"]:focus-visible, [data-slot="textarea"]:focus-visible, [data-slot="select-trigger"]:focus-visible {
    --px-ink: var(--ring);
    box-shadow: inset var(--px) var(--px) 0 0 var(--px-lo), var(--px) var(--px) 0 0 var(--px-shade);
  }

  [data-slot="badge"] { --px: 3px; border: var(--px) solid transparent; }
  [data-slot="badge"][data-variant="outline"], [data-slot="badge"][data-variant="secondary"] { background-color: var(--card); color: var(--foreground); }
  [data-slot="checkbox"] { --px: 2px; border-width: var(--px); }
  [data-slot="switch"] { outline: 2px solid var(--px-ink); outline-offset: 0; }
  [data-slot="separator"] { background: var(--px-ink); }
  [data-slot="table-row"] { border-color: var(--px-ink); }
  [data-slot="dialog-overlay"], [data-slot="alert-dialog-overlay"], [data-slot="sheet-overlay"] {
    background: color-mix(in oklab, var(--background) 70%, transparent);
  }`,

  layouts: [
    "poster",
    "bento",
    "split-hero",
    "full-bleed-bands",
    "index-list",
    "focus-column",
    "topbar-workspace",
    "board",
  ],

  prose: {
    overview:
      "This app is a screen from an 8-bit game. Headings are set in a pixel face, every box has stepped corners where the corner pixel is missing, buttons are bevelled keys, and shadows are flat blocks offset by whole pixels. Colour is flat and bright. It should feel like a start menu: cheerful, a bit silly, and obviously made on a grid.",
    colors:
      "Ink outlines on a pale page, white for boxes, and flat saturated colour in blocks. The accent leads; the chart colours (`bg-chart-2` to `bg-chart-5`) are the rest of the sprite sheet, for tiles, bars, tags and scores. Every colour is solid: no gradients, no transparency, no tints. Text is ink.",
    typography:
      "Headings, buttons and tags are in the pixel face, uppercase; let a headline be huge. Everything else is monospace, so columns line up. Write like a game: short lines, scores, levels, `PRESS START`. Keep paragraphs brief.",
    layout:
      "Build on a visible grid: sizes and gaps in multiples of 4px, blocks square to each other. Big type first, then stats in a row (`20+`, `85+`), then boxes. Scatter one or two small sprites — a heart, a star, a cloud made of squares — in the empty space.",
    elevation:
      "A hard offset block in a darker tone, moved by whole pixels (`shadow-sm` to `shadow-xl`). Buttons are bevelled instead — light on the top-left, dark on the bottom-right — and the bevel flips when pressed. Never a blur.",
    shapes: "Squares with the corner pixel missing, outlined in 4px ink. No rounded corners and no diagonals; a circle is drawn as a stepped octagon of squares or not at all.",
    components: {
      button: "a bevelled key in the pixel face with stepped corners; it hops up one pixel on hover and its bevel flips when pressed.",
      card: "a white box with a 4px ink outline, stepped corners and a hard two-tone shadow.",
      input: "a white box with an ink outline and an inner shade; the outline turns the accent colour on focus.",
      badge: "a small outlined uppercase tag in the pixel face.",
      tabs: "adjoining ink-outlined cells; the active one is filled with ink.",
      dialog: "an outlined box with stepped corners on a large block shadow.",
    },
    icons: "Heavy line icons with square ends at 20–24px. For decoration, build sprites from small squares rather than using an icon.",
    dos: [
      "Set one headline per screen very large in the pixel face.",
      "Show numbers as a game would: scores, levels, lives, a row of hearts, a health bar made of blocks.",
      "Fill tiles and bars with the chart colours, flat, under ink text.",
      "Animate in steps — blink, hop, flash — rather than in smooth fades.",
    ],
    donts: [
      "Don't round, blur or fade anything: no rounded corners, no soft shadows, no gradients, no translucency.",
      "Don't set paragraphs in the pixel face.",
      "Don't use sizes or gaps off the 4px grid, or rotate anything.",
      "Don't use thin grey lines; a line is 4px of ink or it is absent.",
    ],
  },
};
