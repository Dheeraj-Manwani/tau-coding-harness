import type { StyleSpec } from "../types";
import { MONO_FALLBACK, SANS_FALLBACK, staticFont, variableFont } from "./fonts";
import { TABS_TAB } from "./selectors";

const mono = staticFont("Share Tech Mono", "share-tech-mono", [400], MONO_FALLBACK);

const OVERLAYS = `[data-slot="dialog-content"], [data-slot="alert-dialog-content"]`;

/** A box with its bottom-right corner sliced off at 45°, by `--cut`. */
const CUT_ONE = "polygon(0 0, 100% 0, 100% calc(100% - var(--cut)), calc(100% - var(--cut)) 100%, 0 100%)";
/** The same with the top-left corner sliced too. */
const CUT_TWO =
  "polygon(var(--cut) 0, 100% 0, 100% calc(100% - var(--cut)), calc(100% - var(--cut)) 100%, 0 100%, 0 var(--cut))";

/**
 * A border cannot follow a sliced corner, so the slice is edged with a
 * gradient instead: a hairline of `color` painted just inside the cut, on a
 * 45° gradient whose far end is the corner itself. `0.7071` is the distance
 * from that corner to the cut, measured along the diagonal.
 */
const edgeBR = (color: string) =>
  `linear-gradient(135deg, transparent calc(100% - 0.7071 * var(--cut) - 1.5px), ${color} 0)`;
const edgeTL = (color: string) =>
  `linear-gradient(135deg, ${color} calc(0.7071 * var(--cut) + 1.5px), transparent 0)`;

export const cyberpunk: StyleSpec = {
  key: "cyberpunk",
  name: "Cyberpunk",
  look: "A heads-up display from a harder future: black panels with sliced corners, a hazard-bright accent, squared machine lettering, hairline frames, scanlines and status readouts.",
  suits:
    "Games and esports, security and hacking tools, crypto and trading terminals, science-fiction worlds and tabletop companions, drone and hardware dashboards, launch pages with attitude.",
  avoid: "Not for anything friendly, calming, domestic or official — health, home and family, education, banking — or for long reading.",
  group: "tech",
  reach: "niche",
  aka: ["Sci-fi HUD"],

  fonts: {
    display: variableFont("Orbitron", "orbitron", SANS_FALLBACK),
    body: staticFont("Rajdhani", "rajdhani", [400, 500, 600, 700], SANS_FALLBACK),
    mono,
  },
  fontOptions: [
    {
      key: "chakra",
      label: "Chakra Petch + Saira",
      fonts: {
        display: staticFont("Chakra Petch", "chakra-petch", [500, 700], SANS_FALLBACK),
        body: variableFont("Saira", "saira", SANS_FALLBACK),
        mono,
      },
    },
    {
      key: "teko",
      label: "Teko + Jura",
      fonts: {
        display: variableFont("Teko", "teko", SANS_FALLBACK),
        body: variableFont("Jura", "jura", SANS_FALLBACK),
        mono,
      },
    },
  ],
  defaultMode: "dark",
  dials: { variance: 8, motion: 7, density: 7 },
  radius: "0rem",

  palette: {
    neutralHue: "accent",
    // The first two companions are the colours a glitch splits into, either
    // side of the accent's opposite.
    chartHues: [180, -60, 60, 120],
    chartLightness: {
      light: [0.55, 0.5, 0.6, 0.45],
      dark: [0.8, 0.72, 0.84, 0.7],
    },
    light: {
      background: { l: 0.965, c: 0.006 },
      surface: { l: 0.99, c: 0.003 },
      foreground: { l: 0.15, c: 0.015 },
      muted: { l: 0.925, c: 0.008 },
      mutedForeground: { l: 0.43, c: 0.015 },
      border: { l: 0.2, c: 0.015 },
      primary: { l: 0.52, c: 0.26 },
      wash: { l: 0.91, c: 0.05 },
    },
    dark: {
      background: { l: 0.13, c: 0.012 },
      surface: { l: 0.17, c: 0.015 },
      foreground: { l: 0.94, c: 0.012 },
      muted: { l: 0.215, c: 0.018 },
      mutedForeground: { l: 0.71, c: 0.02 },
      border: { l: 0.34, c: 0.03 },
      primary: { l: 0.86, c: 0.19 },
      wash: { l: 0.25, c: 0.06 },
    },
  },

  // No soft shadows. A "shadow" here is a glitch: the thing's edges split
  // into two colours, further apart the larger the size.
  theme: {
    "--shadow-2xs": "none",
    "--shadow-xs": "none",
    "--shadow-sm": "-1px 0 0 0 var(--chart-2), 1px 0 0 0 var(--chart-3)",
    "--shadow-md": "-2px 0 0 0 var(--chart-2), 2px 0 0 0 var(--chart-3)",
    "--shadow-lg": "-3px 0 0 0 var(--chart-2), 3px 0 0 0 var(--chart-3), 0 0 32px -8px color-mix(in oklab, var(--primary) 50%, transparent)",
    "--shadow-xl": "-4px 0 0 0 var(--chart-2), 4px 0 0 0 var(--chart-3), 0 0 56px -10px color-mix(in oklab, var(--primary) 60%, transparent)",
    // The body face is narrow and small for its size.
    "--text-sm": "0.9375rem",
    "--text-base": "1.0625rem",
  },

  baseCss: `
  h1, h2, h3, h4 {
    font-family: var(--font-heading);
    font-weight: 700;
    letter-spacing: 0.02em;
    line-height: 1.05;
    text-transform: uppercase;
  }
  /* The main heading of a dark screen is slightly out of register. */
  .dark h1 {
    text-shadow: -0.03em 0 0 color-mix(in oklab, var(--chart-2) 80%, transparent), 0.03em 0 0 color-mix(in oklab, var(--chart-3) 80%, transparent);
  }
  ::selection { background: var(--primary); color: var(--primary-foreground); }
  * { caret-color: var(--primary); }`,

  // A tube screen: scanlines over everything, and the accent bleeding in from
  // one corner.
  backdrop: `
      repeating-linear-gradient(0deg, color-mix(in oklab, var(--foreground) 4%, transparent) 0 1px, transparent 1px 4px),
      radial-gradient(52rem 32rem at 100% 0%, color-mix(in oklab, var(--primary) 14%, transparent), transparent 70%)`,

  skin: {
    controlHeight: "2.5rem",
    controlPadX: "1.375rem",
    controlRadius: "0",
    controlText: "0.75rem",
    borderWidth: "1px",
    buttonFont: "var(--font-heading)",
    buttonWeight: "700",
    buttonTracking: "0.1em",
    buttonCase: "uppercase",
    field: "outlined",
    fieldRadius: "0",
    fieldPadX: "0.75rem",
    cardRadius: "0",
    cardPad: "1.25rem",
    cardBorder: "1px solid var(--border)",
    cardShadow: "none",
    cardTitleSize: "0.9375rem",
    cardTitleWeight: "700",
    cardTitleTracking: "0.08em",
    badgeRadius: "0",
    badgeFont: "var(--font-mono)",
    badgeCase: "uppercase",
    badgeTracking: "0.08em",
    badgeWeight: "400",
    badgeText: "0.6875rem",
    badgePad: "0.125rem 0.625rem 0.125rem 0.5rem",
    tabs: "segmented",
    tabsRadius: "0px",
    overlayRadius: "0",
    overlayBorder: "1px solid var(--primary)",
    overlayShadow: "var(--shadow-lg)",
    labelFont: "var(--font-mono)",
    labelCase: "uppercase",
    labelTracking: "0.1em",
    labelText: "0.6875rem",
    labelWeight: "400",
    checkRadius: "0",
    iconStroke: "1.5",
  },

  skinCss: `
  /* Buttons are plates with two corners sliced off. */
  [data-slot="button"]:not([data-variant="ghost"], [data-variant="link"]) {
    --cut: 0.625rem;
    clip-path: ${CUT_TWO};
    background-origin: border-box;
    transition: transform 120ms ease, background-color 120ms ease, color 120ms ease;
  }
  [data-slot="button"][data-variant="default"]:hover {
    background-color: var(--foreground);
    color: var(--background);
    text-shadow: -1px 0 0 var(--chart-2), 1px 0 0 var(--chart-3);
  }
  [data-slot="button"]:active { transform: translate(1px, 1px); }
  [data-slot="button"][data-variant="outline"], [data-slot="button"][data-variant="secondary"] {
    background-color: transparent;
    background-image: ${edgeTL("var(--primary)")}, ${edgeBR("var(--primary)")};
    border-color: var(--primary);
    color: var(--primary);
  }
  [data-slot="button"][data-variant="outline"]:hover, [data-slot="button"][data-variant="secondary"]:hover {
    background-color: color-mix(in oklab, var(--primary) 16%, transparent);
  }
  /* A clipped shape would clip its own focus ring, so focus squares it off. */
  [data-slot="button"]:focus-visible { clip-path: none; outline: 2px solid var(--ring); outline-offset: 3px; }

  /* A panel: one corner sliced, a hairline along the slice, and a short bar
     of the accent at the opposite corner. */
  [data-slot="card"] {
    --cut: 1rem;
    clip-path: ${CUT_ONE};
    background-image: linear-gradient(var(--primary), var(--primary)), ${edgeBR("var(--border)")};
    background-size: 3rem 2px, auto;
    background-repeat: no-repeat;
    background-origin: border-box;
    transition: border-color 160ms ease;
  }
  a[data-slot="card"]:hover, button[data-slot="card"]:hover { border-color: var(--primary); }
  [data-slot="card-title"] { text-transform: uppercase; }
  [data-slot="card-title"]::before { content: "// "; color: var(--primary); }
  [data-slot="card-footer"] { background: transparent; border-top: 1px dashed var(--border); }

  [data-slot="input"], [data-slot="textarea"], [data-slot="select-trigger"] {
    background-color: var(--background);
    border-left-width: 3px;
    border-left-color: var(--primary);
  }
  [data-slot="input"]:focus-visible, [data-slot="textarea"]:focus-visible, [data-slot="select-trigger"]:focus-visible {
    border-color: var(--primary);
    box-shadow: var(--shadow-sm);
  }

  [data-slot="badge"] {
    --cut: 0.4375rem;
    clip-path: ${CUT_ONE};
    background-color: transparent;
    background-image: ${edgeBR("currentColor")};
    background-origin: border-box;
    border: 1px solid currentColor;
    color: var(--muted-foreground);
  }
  [data-slot="badge"][data-variant="default"] { background-color: var(--primary); border-color: var(--primary); color: var(--primary-foreground); }
  [data-slot="badge"][data-variant="destructive"] { color: var(--destructive); }

  ${TABS_TAB} { font-family: var(--font-mono); font-size: 0.75rem; letter-spacing: 0.08em; text-transform: uppercase; }
  ${TABS_TAB}[data-active] {
    --cut: 0.4375rem;
    clip-path: ${CUT_ONE};
    background: var(--primary);
    color: var(--primary-foreground);
    box-shadow: none;
  }

  ${OVERLAYS} {
    --cut: 1.25rem;
    clip-path: ${CUT_ONE};
    background-image: ${edgeBR("var(--primary)")};
    background-origin: border-box;
  }
  [data-slot="separator"] { background: var(--border); }
  [data-slot="dialog-overlay"], [data-slot="alert-dialog-overlay"], [data-slot="sheet-overlay"] {
    background: color-mix(in oklab, var(--background) 78%, transparent);
    backdrop-filter: blur(3px);
  }`,

  layouts: [
    "dashboard-grid",
    "sidebar-shell",
    "split-tool",
    "master-detail",
    "poster",
    "split-hero",
    "bento",
    "topbar-workspace",
  ],

  prose: {
    overview:
      "This app is an interface from a science-fiction film: a heads-up display. Panels are black plates with a corner sliced off, framed in hairlines; the accent is as bright as a warning sign; lettering is squared and uppercase; faint scanlines cross the whole screen. Everything reports a status. It should feel tense and technical.",
    colors:
      "Near-black and one hazard-bright accent, which fills the main button, edges what is active and marks every panel with a short bar. The first two chart colours (`bg-chart-2`, `bg-chart-3`) are the glitch pair: use them together as thin offset edges, never as fills. Text is cold off-white.",
    typography:
      "Headings in the squared display face, bold and uppercase. Text in a narrow technical sans. Every label, tag, tab and readout in uppercase monospace. Write like a system: `STATUS: ONLINE`, `SYS.04`, `// ACCESS GRANTED`, `ERR_TIMEOUT`, coordinates, build numbers.",
    layout:
      "Fill the screen with framed panels of unequal size, close together, like instruments. Add readouts in the corners and thin rules with tick marks between sections. Angles are 45° only.",
    elevation:
      "No soft shadows. `shadow-sm` to `shadow-xl` split a thing's edges into the two glitch colours, wider as they grow: use them on what is selected, alerting or pressed. Panels are flat.",
    shapes: "Square, with corners sliced at 45°: two on a button, one on a panel or tag. One-pixel lines. Panels are clipped to their shape, so nothing may hang outside a panel's edge.",
    components: {
      button: "a plate of the accent with two sliced corners and a bold uppercase label; it inverts and glitches on hover. The outline variant is a hairline frame in the accent.",
      card: "a black hairline-framed plate with its bottom-right corner sliced off, a short accent bar at the top left, and a title that starts with `//`.",
      input: "a square field with a thick accent bar down its left side.",
      badge: "a small monospace tag with one sliced corner; the default one is filled with the accent.",
      tabs: "uppercase monospace words in a dark tray; the active one is an accent plate.",
      dialog: "a plate framed in the accent with a sliced corner, over a darkened screen.",
    },
    icons: "Thin line icons at 16–18px, in the accent when they mark something live. Brackets and chevrons as text (`[ ]`, `>>`) are part of the look.",
    dos: [
      "Give every panel a status line: an id, a state, a number that could be changing.",
      "Show levels as segmented bars, and data as thin line charts in the accent.",
      "Let things flicker in, type themselves out, or shift a pixel on hover.",
    ],
    donts: [
      "Don't round anything, and don't use soft drop shadows or pastel colours.",
      "Don't hang anything over the edge of a panel; it will be cut off.",
      "Don't fill large areas with the accent, or glitch more than one thing at a time.",
    ],
  },
};
