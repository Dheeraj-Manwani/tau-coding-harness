import type { StyleSpec } from "../types";
import { SANS_FALLBACK, SYSTEM_MONO, variableFont } from "./fonts";
import { TABS_LIST, TABS_TAB, UNCHECKED } from "./selectors";

const lexend = variableFont("Lexend Deca", "lexend-deca", SANS_FALLBACK);
const kumbh = variableFont("Kumbh Sans", "kumbh-sans", SANS_FALLBACK);
const mulish = variableFont("Mulish", "mulish", SANS_FALLBACK);

const SOLID_BUTTON = `[data-slot="button"]:not([data-variant="ghost"], [data-variant="link"])`;
const FIELDS = `[data-slot="input"], [data-slot="textarea"], [data-slot="select-trigger"]`;

/** Pressed into the surface: the two shadows of a raised shape, turned inward. */
const WELL = "inset 3px 3px 7px 0 var(--neu-lo), inset -3px -3px 7px 0 var(--neu-hi)";

export const neumorphic: StyleSpec = {
  key: "neumorphic",
  name: "Neumorphic",
  look: "One soft material: panels and controls pushed out of, or pressed into, a single pale surface, drawn with a light shadow on one side and a dark one on the other instead of with colour.",
  suits:
    "Smart-home and device controls, music players and remotes, calculators, timers and clocks, settings screens, small single-purpose tools — anything with a few large controls.",
  avoid: "Not for text-heavy pages, data tables, shops and marketing sites, or for anything read in a hurry or in bright light: it is a low-contrast look by nature.",
  group: "tactile",
  reach: "niche",
  aka: ["Neumorphism", "Soft UI"],

  fonts: { display: lexend, body: lexend, mono: SYSTEM_MONO },
  fontOptions: [
    { key: "kumbh", label: "Kumbh Sans", fonts: { display: kumbh, body: kumbh, mono: SYSTEM_MONO } },
    { key: "mulish", label: "Mulish", fonts: { display: mulish, body: mulish, mono: SYSTEM_MONO } },
  ],
  defaultMode: "light",
  dials: { variance: 3, motion: 5, density: 3 },
  radius: "1rem",

  palette: {
    neutralHue: "accent",
    chartHues: [40, -40, 150, 200],
    light: {
      // Page and panel are one colour. That is the whole idea: a shape is told
      // from the surface by its shadows alone.
      background: { l: 0.925, c: 0.012 },
      surface: { l: 0.925, c: 0.012 },
      foreground: { l: 0.3, c: 0.025 },
      muted: { l: 0.895, c: 0.014 },
      mutedForeground: { l: 0.46, c: 0.025 },
      // Deliberately a real line, where the pure style would have none. See the
      // note on edges in the skin below.
      border: { l: 0.8, c: 0.016 },
      primary: { l: 0.55, c: 0.17 },
      wash: { l: 0.89, c: 0.035 },
    },
    dark: {
      background: { l: 0.25, c: 0.012 },
      surface: { l: 0.25, c: 0.012 },
      foreground: { l: 0.93, c: 0.01 },
      muted: { l: 0.215, c: 0.012 },
      mutedForeground: { l: 0.75, c: 0.02 },
      border: { l: 0.37, c: 0.016 },
      primary: { l: 0.74, c: 0.14 },
      wash: { l: 0.31, c: 0.035 },
    },
  },

  theme: {
    "--shadow-2xs": "1px 1px 2px 0 var(--neu-lo), -1px -1px 2px 0 var(--neu-hi)",
    "--shadow-xs": "2px 2px 5px 0 var(--neu-lo), -2px -2px 5px 0 var(--neu-hi)",
    "--shadow-sm": "4px 4px 9px 0 var(--neu-lo), -4px -4px 9px 0 var(--neu-hi)",
    "--shadow-md": "7px 7px 16px 0 var(--neu-lo), -7px -7px 16px 0 var(--neu-hi)",
    "--shadow-lg": "12px 12px 26px 0 var(--neu-lo), -12px -12px 26px 0 var(--neu-hi)",
    "--shadow-xl": "18px 18px 40px 0 var(--neu-lo), -18px -18px 40px 0 var(--neu-hi)",
    "--inset-shadow-2xs": "inset 1px 1px 2px 0 var(--neu-lo), inset -1px -1px 2px 0 var(--neu-hi)",
    "--inset-shadow-xs": "inset 2px 2px 4px 0 var(--neu-lo), inset -2px -2px 4px 0 var(--neu-hi)",
    "--inset-shadow-sm": WELL,
  },

  baseCss: `
  /* The light comes from the top left: a highlight toward it, a shade away. */
  html {
    --neu-hi: color-mix(in oklab, white 90%, transparent);
    --neu-lo: color-mix(in oklab, var(--foreground) 22%, transparent);
  }
  html.dark {
    --neu-hi: color-mix(in oklab, white 8%, transparent);
    --neu-lo: color-mix(in oklab, black 55%, transparent);
  }
  h1, h2, h3, h4 {
    font-family: var(--font-heading);
    font-weight: 600;
    letter-spacing: -0.02em;
    line-height: 1.15;
  }`,

  skin: {
    controlHeight: "2.75rem",
    controlPadX: "1.375rem",
    controlRadius: "0.875rem",
    controlText: "0.9375rem",
    borderWidth: "1px",
    buttonFont: "var(--font-sans)",
    buttonWeight: "600",
    buttonTracking: "0.01em",
    buttonCase: "none",
    field: "filled",
    fieldRadius: "0.875rem",
    fieldPadX: "1rem",
    cardRadius: "1.5rem",
    cardPad: "1.5rem",
    cardBorder: "0",
    cardShadow: "var(--shadow-md)",
    cardTitleSize: "1.0625rem",
    cardTitleWeight: "600",
    cardTitleTracking: "0",
    badgeRadius: "9999px",
    badgeFont: "var(--font-sans)",
    badgeCase: "none",
    badgeTracking: "0",
    badgeWeight: "600",
    badgeText: "0.75rem",
    badgePad: "0.25rem 0.75rem",
    tabs: "segmented",
    tabsRadius: "1rem",
    overlayRadius: "1.5rem",
    overlayBorder: "1px solid var(--border)",
    // A menu or dialog floats over the page; paired shadows only work for
    // something that is part of the surface.
    overlayShadow: "0 24px 60px -20px color-mix(in oklab, black 40%, transparent)",
    labelFont: "var(--font-sans)",
    labelCase: "none",
    labelTracking: "0",
    labelText: "0.8125rem",
    labelWeight: "600",
    checkRadius: "0.375rem",
    iconStroke: "1.75",
  },

  // Edges. The style in its pure form has no lines at all, and its controls are
  // hard to find for anyone whose sight or screen is less than perfect. So this
  // version keeps a faint real edge on everything that can be pressed or typed
  // into, fills the main button with the accent, and marks focus with a solid
  // accent ring. Panels, which are not controls, stay edgeless.
  skinCss: `
  ${SOLID_BUTTON} {
    border-color: var(--border);
    box-shadow: var(--shadow-sm);
    transition: box-shadow 160ms ease, transform 160ms ease, color 160ms ease;
  }
  ${SOLID_BUTTON}:hover { box-shadow: var(--shadow-xs); }
  ${SOLID_BUTTON}:active { box-shadow: ${WELL}; transform: scale(0.99); }
  [data-slot="button"][data-variant="default"] { border-color: transparent; }
  [data-slot="button"][data-variant="outline"], [data-slot="button"][data-variant="secondary"] {
    background: var(--background);
    color: var(--foreground);
  }
  [data-slot="button"][data-variant="outline"]:hover, [data-slot="button"][data-variant="secondary"]:hover {
    background: var(--background);
    color: color-mix(in oklab, var(--primary) 70%, var(--foreground));
  }
  [data-slot="button"]:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }

  [data-slot="card-footer"] { background: transparent; border-top: 0; }

  /* Anything typed into or switched is a well in the surface. */
  ${FIELDS} { background: var(--background); border-color: var(--border); box-shadow: ${WELL}; }
  [data-slot="input"]:focus-visible, [data-slot="textarea"]:focus-visible, [data-slot="select-trigger"]:focus-visible {
    background: var(--background);
    border-color: var(--ring);
    box-shadow: ${WELL}, 0 0 0 2px var(--ring);
  }
  [data-slot="checkbox"]${UNCHECKED} {
    background: var(--background);
    border-color: var(--border);
    box-shadow: inset 2px 2px 4px 0 var(--neu-lo), inset -2px -2px 4px 0 var(--neu-hi);
  }
  [data-slot="switch"]${UNCHECKED} {
    background: var(--muted);
    box-shadow: inset 2px 2px 4px 0 var(--neu-lo), inset -2px -2px 4px 0 var(--neu-hi);
  }
  [data-slot="switch-thumb"] { box-shadow: 1px 1px 3px 0 var(--neu-lo); }

  [data-slot="badge"] { background: var(--background); color: var(--foreground); border-color: transparent; box-shadow: var(--shadow-2xs); }
  [data-slot="badge"][data-variant="default"] { color: color-mix(in oklab, var(--primary) 70%, var(--foreground)); }
  [data-slot="badge"][data-variant="destructive"] { color: var(--destructive); }

  ${TABS_LIST} { background: var(--background); box-shadow: ${WELL}; }
  ${TABS_TAB}[data-active] { color: color-mix(in oklab, var(--primary) 70%, var(--foreground)); box-shadow: var(--shadow-xs); }

  [data-slot="dialog-overlay"], [data-slot="alert-dialog-overlay"], [data-slot="sheet-overlay"] {
    background: color-mix(in oklab, var(--background) 65%, transparent);
    backdrop-filter: blur(6px);
  }`,

  layouts: [
    "focus-column",
    "dashboard-grid",
    "bento",
    "topbar-workspace",
    "split-tool",
    "split-hero",
    "sidebar-shell",
  ],

  prose: {
    overview:
      "This app looks moulded from one piece of soft plastic. The page, the panels and the controls are all the same pale colour; a shape exists because light falls on one side of it and shadow on the other. Raised things can be pressed, sunken things can be filled in. It should feel quiet, physical and precise, like a well-made thermostat.",
    colors:
      "One surface colour for page and panels: `bg-background` and `bg-card` are the same, on purpose. The accent is the only real colour: it fills the main button and marks what is on, selected or in progress. Text is a dark tinted grey, kept at full strength because contrast is low everywhere else.",
    typography:
      "One open, rounded-geometric sans at semibold for headings and regular for text. Figures — a temperature, a time, a level — are the heroes: set them large. Sentence case throughout. Do not use light weights or small grey text; the surface already lacks contrast.",
    layout:
      "A few large controls with wide gaps, never a crowd: paired shadows need 24px or more of clear surface around each shape or they smear into each other. One main dial, figure or control per screen, with smaller ones grouped beneath.",
    elevation:
      "Two directions only. Raised (`shadow-xs` to `shadow-xl`): a dark shadow to the bottom right and a light one to the top left, for panels, buttons and anything that can be pressed. Sunken (`inset-shadow-sm`): the same pair turned inward, for fields, tracks and whatever is pressed now. Never a plain grey drop shadow.",
    shapes: "Soft and round: 24px on panels, 14px on controls, full circles for dials and icon buttons. Panels have no outline; controls have a faint one-pixel edge so they can be found.",
    components: {
      button: "a raised cushion of the surface with a faint edge, sinking into a well when pressed; the main one is filled with the accent.",
      card: "a raised, edgeless panel of the same colour as the page.",
      input: "a well pressed into the surface, with a solid accent ring when focused.",
      badge: "a small raised pill of the surface; the default one has accent-coloured text.",
      tabs: "a sunken tray with a raised cushion for the active tab.",
      dialog: "a rounded sheet with a hairline edge over a blurred page.",
    },
    icons: "Line icons at 20px, usually centred in a raised circle (`size-11 rounded-full shadow-sm`). An icon turns the accent colour when its thing is on.",
    dos: [
      "Use a raised circle for every icon button and a sunken track for every slider and progress bar.",
      "Show what is on or selected by pressing it in (`inset-shadow-sm`) and colouring its icon or text with the accent.",
      "Build a screen around one big figure or dial.",
    ],
    donts: [
      "Don't put a panel on a different colour from the page; the effect only works on one continuous surface.",
      "Don't remove the edge from buttons and fields, or rely on shadow alone to show that something can be pressed.",
      "Don't nest raised shapes more than two deep, or place them closer than 24px.",
      "Don't use the style for tables, long forms or pages of text.",
    ],
  },
};
