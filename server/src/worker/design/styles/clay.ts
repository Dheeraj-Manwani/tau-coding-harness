import type { StyleSpec } from "../types";
import { SANS_FALLBACK, SYSTEM_MONO, variableFont } from "./fonts";
import { TABS_LIST, UNCHECKED } from "./selectors";

const SOLID_BUTTON = `[data-slot="button"]:not([data-variant="ghost"], [data-variant="link"])`;
const FIELDS = `[data-slot="input"], [data-slot="textarea"], [data-slot="select-trigger"]`;

/** Lit from above: a highlight inside the top edge, a shade inside the bottom. */
const PUFF = "inset 0 -5px 8px 0 var(--clay-lo), inset 0 4px 6px 0 var(--clay-hi)";
/** The same, the other way up: something pushed into the surface. */
const DENT = "inset 0 4px 7px 0 var(--clay-lo), inset 0 -3px 4px 0 var(--clay-hi)";

export const clay: StyleSpec = {
  key: "clay",
  name: "Clay",
  look: "Soft 3D you want to squeeze: puffy, inflated shapes in pastel colours, lit from above with an inner highlight and resting on a deep soft shadow.",
  suits:
    "Children's and learning apps, onboarding, habit and mood trackers, casual games, savings and pocket-money apps, friendly product pages — anything that should feel cuddly and easy.",
  avoid: "Not for dense data tools, news and long reading, or for anything formal, luxurious or technical.",
  group: "tactile",
  reach: "niche",
  aka: ["Claymorphism"],

  fonts: {
    display: variableFont("Rubik", "rubik", SANS_FALLBACK),
    body: variableFont("Nunito", "nunito", SANS_FALLBACK),
    mono: SYSTEM_MONO,
  },
  fontOptions: [
    {
      key: "dynapuff",
      label: "DynaPuff + Nunito Sans",
      fonts: {
        display: variableFont("DynaPuff", "dynapuff", SANS_FALLBACK),
        body: variableFont("Nunito Sans", "nunito-sans", SANS_FALLBACK),
        mono: SYSTEM_MONO,
      },
    },
    {
      key: "comfortaa",
      label: "Comfortaa + Quicksand",
      fonts: {
        display: variableFont("Comfortaa", "comfortaa", SANS_FALLBACK),
        body: variableFont("Quicksand", "quicksand", SANS_FALLBACK),
        mono: SYSTEM_MONO,
      },
    },
  ],
  defaultMode: "light",
  dials: { variance: 5, motion: 7, density: 3 },
  radius: "1.25rem",

  palette: {
    neutralHue: "accent",
    // Clay comes in a box of colours: the companions are far apart, and pale
    // enough to fill whole blobs under ink text.
    chartHues: [60, 150, -70, 210],
    chartLightness: {
      light: [0.82, 0.84, 0.8, 0.86],
      dark: [0.62, 0.64, 0.6, 0.66],
    },
    light: {
      background: { l: 0.955, c: 0.03 },
      surface: { l: 0.99, c: 0.012 },
      foreground: { l: 0.28, c: 0.05 },
      muted: { l: 0.925, c: 0.04 },
      mutedForeground: { l: 0.47, c: 0.05 },
      border: { l: 0.89, c: 0.04 },
      primary: { l: 0.66, c: 0.16 },
      wash: { l: 0.91, c: 0.06 },
    },
    dark: {
      background: { l: 0.24, c: 0.045 },
      surface: { l: 0.3, c: 0.05 },
      foreground: { l: 0.96, c: 0.02 },
      muted: { l: 0.345, c: 0.05 },
      mutedForeground: { l: 0.8, c: 0.04 },
      border: { l: 0.4, c: 0.05 },
      primary: { l: 0.78, c: 0.13 },
      wash: { l: 0.38, c: 0.07 },
    },
  },

  theme: {
    "--shadow-2xs": `0 2px 4px -1px var(--clay-drop)`,
    "--shadow-xs": `0 4px 8px -3px var(--clay-drop), inset 0 -2px 3px 0 var(--clay-lo), inset 0 2px 3px 0 var(--clay-hi)`,
    "--shadow-sm": `0 8px 16px -8px var(--clay-drop), inset 0 -3px 5px 0 var(--clay-lo), inset 0 3px 4px 0 var(--clay-hi)`,
    "--shadow-md": `0 14px 26px -12px var(--clay-drop), ${PUFF}`,
    "--shadow-lg": `0 22px 40px -16px var(--clay-drop), inset 0 -8px 12px 0 var(--clay-lo), inset 0 6px 10px 0 var(--clay-hi)`,
    "--shadow-xl": `0 34px 60px -22px var(--clay-drop), inset 0 -10px 16px 0 var(--clay-lo), inset 0 8px 12px 0 var(--clay-hi)`,
    "--inset-shadow-2xs": "inset 0 2px 3px 0 var(--clay-lo)",
    "--inset-shadow-xs": "inset 0 3px 5px 0 var(--clay-lo), inset 0 -2px 3px 0 var(--clay-hi)",
    "--inset-shadow-sm": DENT,
  },

  baseCss: `
  /* The light on the clay: a highlight, a shade, and the shadow it rests on. */
  html {
    --clay-hi: color-mix(in oklab, white 75%, transparent);
    --clay-lo: color-mix(in oklab, var(--foreground) 13%, transparent);
    --clay-drop: color-mix(in oklab, var(--foreground) 26%, transparent);
  }
  html.dark {
    --clay-hi: color-mix(in oklab, white 15%, transparent);
    --clay-lo: color-mix(in oklab, black 36%, transparent);
    --clay-drop: color-mix(in oklab, black 62%, transparent);
  }
  h1, h2, h3, h4 {
    font-family: var(--font-heading);
    font-weight: 700;
    letter-spacing: -0.015em;
    line-height: 1.1;
  }
  body { font-weight: 500; }`,

  skin: {
    controlHeight: "3rem",
    controlPadX: "1.5rem",
    controlRadius: "1.125rem",
    controlText: "1rem",
    borderWidth: "1px",
    buttonFont: "var(--font-heading)",
    buttonWeight: "600",
    buttonTracking: "0",
    buttonCase: "none",
    field: "filled",
    fieldRadius: "1rem",
    fieldPadX: "1.125rem",
    cardRadius: "2rem",
    cardPad: "1.75rem",
    cardBorder: "0",
    cardShadow: "var(--shadow-lg)",
    cardTitleSize: "1.25rem",
    cardTitleWeight: "700",
    cardTitleTracking: "-0.01em",
    badgeRadius: "9999px",
    badgeFont: "var(--font-heading)",
    badgeCase: "none",
    badgeTracking: "0",
    badgeWeight: "600",
    badgeText: "0.75rem",
    badgePad: "0.25rem 0.75rem",
    tabs: "segmented",
    tabsRadius: "1.25rem",
    overlayRadius: "2rem",
    overlayBorder: "0",
    overlayShadow: "var(--shadow-xl)",
    labelFont: "var(--font-sans)",
    labelCase: "none",
    labelTracking: "0",
    labelText: "0.9375rem",
    labelWeight: "700",
    checkRadius: "0.5rem",
    iconStroke: "2.5",
    iconSize: "1.375rem",
  },

  skinCss: `
  /* A button is a pillow: it swells on hover and dents when pressed. */
  ${SOLID_BUTTON} {
    border-color: transparent;
    box-shadow: 0 8px 14px -6px var(--clay-drop), ${PUFF};
    transition: transform 180ms cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 180ms ease;
  }
  ${SOLID_BUTTON}:hover {
    transform: translateY(-2px) scale(1.02);
    box-shadow: 0 14px 22px -10px var(--clay-drop), ${PUFF};
  }
  ${SOLID_BUTTON}:active {
    transform: translateY(1px) scale(0.97);
    box-shadow: 0 2px 4px -2px var(--clay-drop), ${DENT};
  }
  [data-slot="button"][data-variant="default"]:hover { background: var(--primary); }
  [data-slot="button"][data-variant="outline"] { background: var(--card); color: var(--foreground); }
  [data-slot="button"][data-variant="secondary"] { background: var(--accent); color: var(--accent-foreground); }

  [data-slot="card-footer"] { background: transparent; border-top: 0; }

  /* A field is a dent in the surface, the opposite of a button. */
  ${FIELDS} { box-shadow: ${DENT}; }
  [data-slot="input"]:focus-visible, [data-slot="textarea"]:focus-visible, [data-slot="select-trigger"]:focus-visible {
    box-shadow: ${DENT}, 0 0 0 3px color-mix(in oklab, var(--ring) 35%, transparent);
  }
  [data-slot="checkbox"]${UNCHECKED} { background: var(--muted); border-color: transparent; box-shadow: inset 0 2px 4px 0 var(--clay-lo); }
  [data-slot="switch"]${UNCHECKED} { background: var(--muted); box-shadow: inset 0 2px 4px 0 var(--clay-lo); }

  [data-slot="badge"] { border-color: transparent; box-shadow: inset 0 -2px 3px 0 var(--clay-lo), inset 0 2px 3px 0 var(--clay-hi); }
  [data-slot="badge"][data-variant="secondary"], [data-slot="badge"][data-variant="outline"] { background: var(--accent); color: var(--accent-foreground); }

  ${TABS_LIST} { box-shadow: ${DENT}; }
  [data-slot="dialog-overlay"], [data-slot="alert-dialog-overlay"], [data-slot="sheet-overlay"] {
    background: color-mix(in oklab, var(--foreground) 30%, transparent);
    backdrop-filter: blur(6px);
  }`,

  layouts: [
    "bento",
    "split-hero",
    "full-bleed-bands",
    "focus-column",
    "topbar-workspace",
    "board",
    "dashboard-grid",
  ],

  prose: {
    overview:
      "This app is modelled out of soft clay. Every shape is puffed up like a cushion: a pale highlight inside its top edge, a shade inside its bottom edge, and a deep blurry shadow underneath, as if lit from above on a table. Colours are pastel and several are in use at once. It should feel friendly, touchable and a little toy-like.",
    colors:
      "A pastel page tinted by the accent, near-white panels, and the accent at a soft strength. The chart colours (`bg-chart-2` to `bg-chart-5`) are more pastel clay for blobs, icon tiles and category blocks, always under ink text. Text is a deep tinted ink, never black. No gradients: the roundness comes from the shadows.",
    typography:
      "A rounded, sturdy face for headings, buttons and tags, at bold; a soft rounded sans at medium for sentences. Sizes are comfortable and large. Sentence case, short friendly wording.",
    layout:
      "Few, large, well-separated shapes: a puffed shape needs room for its shadow, so keep gaps wide (`gap-6` or more) and padding generous. Mix sizes like building blocks. Put a clay icon tile or a rounded illustration beside each heading.",
    elevation:
      "Everything raised is inflated: `shadow-sm` to `shadow-xl` each give an inner highlight, an inner shade and a soft drop, larger for bigger things. Things you type into or choose from are pressed in instead (`inset-shadow-sm`). Never a flat panel, a hard edge or a thin grey shadow.",
    shapes: "Fat and round: 32px corners on panels, 18px on buttons, 16px on fields, pills for tags. No outlines anywhere.",
    components: {
      button: "a cushion of the accent with a lit top and a shaded base; it swells on hover and dents when pressed.",
      card: "a near-white, very rounded, inflated slab on a deep soft shadow.",
      input: "a rounded dent pressed into the surface, with a soft accent halo when focused.",
      badge: "a small puffed pill.",
      tabs: "a dented tray holding a raised pillow for the active tab.",
      dialog: "a large inflated slab over a blurred, dimmed page.",
    },
    icons: "Thick rounded line icons at 20–24px, sitting in a puffed tile of pastel colour (`size-12 rounded-2xl bg-chart-2 shadow-sm`).",
    dos: [
      "Give every icon its own clay tile in one of the chart colours.",
      "Use `shadow-md` or `shadow-lg` on blocks of your own so they are inflated like the cards.",
      "Show progress as fat rounded bars and rings.",
      "Make things bounce a little when they appear and when they are pressed.",
    ],
    donts: [
      "Don't draw borders or outlines; edges come from light and shadow.",
      "Don't use sharp corners, thin lines or small tight components.",
      "Don't pack shapes close together; their shadows need space.",
      "Don't use dark, saturated or gradient fills over large areas.",
    ],
  },
};
