import type { StyleSpec } from "../types";
import { MONO_FALLBACK, variableFont } from "./fonts";

const mono = variableFont("JetBrains Mono", "jetbrains-mono", MONO_FALLBACK);

export const terminal: StyleSpec = {
  key: "terminal",
  name: "Terminal",
  look: "A command line made beautiful: monospace everywhere, a near-black screen, one phosphor accent, square corners, dense rows.",
  suits:
    "Developer tools, logs and monitors, crypto and trading, hacker-flavoured side projects, text adventures, anything for people who live in an editor.",
  avoid: "Not for consumer apps, or for people who do not work at a keyboard.",

  fonts: { display: mono, body: mono, mono },
  defaultMode: "dark",
  dials: { variance: 4, motion: 3, density: 8 },
  radius: "0rem",

  palette: {
    neutralHue: "accent",
    chartHues: [60, -60, 120, 180],
    light: {
      background: { l: 0.972, c: 0.01 },
      surface: { l: 0.99, c: 0.006 },
      foreground: { l: 0.22, c: 0.02 },
      muted: { l: 0.932, c: 0.012 },
      mutedForeground: { l: 0.47, c: 0.02 },
      border: { l: 0.8, c: 0.02 },
      primary: { l: 0.5, c: 0.17 },
      wash: { l: 0.92, c: 0.04 },
    },
    dark: {
      background: { l: 0.14, c: 0.012 },
      surface: { l: 0.17, c: 0.014 },
      foreground: { l: 0.9, c: 0.03 },
      muted: { l: 0.21, c: 0.016 },
      mutedForeground: { l: 0.66, c: 0.03 },
      border: { l: 0.31, c: 0.03 },
      primary: { l: 0.83, c: 0.2 },
      wash: { l: 0.24, c: 0.05 },
    },
  },

  theme: {
    "--text-xs": "0.6875rem",
    "--text-sm": "0.8125rem",
    "--text-base": "0.875rem",
    "--text-base--line-height": "1.6",
    "--text-lg": "1rem",
    "--shadow-2xs": "none",
    "--shadow-xs": "none",
    "--shadow-sm": "none",
    "--shadow-md": "0 0 24px -8px color-mix(in oklab, var(--primary) 50%, transparent)",
    "--shadow-lg": "0 0 40px -10px color-mix(in oklab, var(--primary) 55%, transparent)",
    "--shadow-xl": "0 0 60px -12px color-mix(in oklab, var(--primary) 60%, transparent)",
  },

  baseCss: `
  h1, h2, h3, h4 {
    font-family: var(--font-heading);
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1.15;
  }
  body { font-variant-ligatures: none; }
  ::selection { background: var(--primary); color: var(--primary-foreground); }
  * { caret-color: var(--primary); }`,

  skin: {
    controlHeight: "2rem",
    controlPadX: "0.875rem",
    controlRadius: "0",
    controlText: "0.8125rem",
    borderWidth: "1px",
    buttonFont: "var(--font-mono)",
    buttonWeight: "500",
    buttonTracking: "0",
    buttonCase: "lowercase",
    field: "outlined",
    fieldRadius: "0",
    fieldPadX: "0.625rem",
    cardRadius: "0",
    cardPad: "1rem",
    cardBorder: "1px solid var(--border)",
    cardShadow: "none",
    cardTitleSize: "0.75rem",
    cardTitleWeight: "500",
    cardTitleTracking: "0.08em",
    badgeRadius: "0",
    badgeFont: "var(--font-mono)",
    badgeCase: "lowercase",
    badgeTracking: "0",
    badgeWeight: "500",
    badgeText: "0.6875rem",
    badgePad: "0.0625rem 0.375rem",
    tabs: "underline",
    tabsRadius: "0",
    overlayRadius: "0",
    overlayBorder: "1px solid var(--primary)",
    overlayShadow: "var(--shadow-lg)",
    labelFont: "var(--font-mono)",
    labelCase: "uppercase",
    labelTracking: "0.08em",
    labelText: "0.6875rem",
    labelWeight: "500",
    checkRadius: "0",
    iconStroke: "1.5",
  },

  skinCss: `
  /* A card is a pane: its title is a prompt line. */
  [data-slot="card-title"] { text-transform: uppercase; color: var(--muted-foreground); }
  [data-slot="card-title"]::before { content: "> "; color: var(--primary); }
  [data-slot="card-footer"] { background: transparent; }

  [data-slot="button"][data-variant="outline"] { border-color: var(--primary); color: var(--primary); background: transparent; }
  [data-slot="button"][data-variant="outline"]:hover { background: var(--primary); color: var(--primary-foreground); }
  [data-slot="button"][data-variant="default"]:hover { box-shadow: var(--shadow-md); }

  [data-slot="input"], [data-slot="textarea"], [data-slot="select-trigger"] { background: var(--background); }
  [data-slot="input"]:focus-visible, [data-slot="textarea"]:focus-visible, [data-slot="select-trigger"]:focus-visible {
    border-color: var(--primary);
    box-shadow: none;
  }

  [data-slot="badge"] { background: transparent; border: 1px solid currentColor; color: var(--muted-foreground); }
  [data-slot="badge"][data-variant="default"] { color: var(--primary); }
  [data-slot="badge"][data-variant="destructive"] { color: var(--destructive); }
  [data-slot="tabs-trigger"][data-active] { color: var(--primary); border-bottom-color: var(--primary); }`,

  layouts: [
    "sidebar-shell",
    "dashboard-grid",
    "split-tool",
    "master-detail",
    "focus-column",
    "topbar-workspace",
    "poster",
    "index-list",
  ],

  prose: {
    overview:
      "This app looks like a terminal that someone cared about. One monospace typeface, a dark screen, a single glowing accent, and information packed into aligned rows and panes. It rewards people who read closely.",
    colors:
      "A near-black screen faintly tinted by the accent, soft off-white text, and one phosphor accent for the prompt, the cursor, the active item and the one key action. Status may use the chart colours; nothing else adds colour.",
    typography:
      "Everything is monospace, so alignment is free: line things up in columns and use the character grid. Sizes are small and vary little; make hierarchy with weight, uppercase and the accent colour instead. Labels are uppercase and letterspaced. Use real terminal conventions — `>` prompts, `[ok]` and `[err]` markers, `--flags`, lowercase commands.",
    layout:
      "Divide the screen into bordered panes that share edges, like a tiled window manager. Fill the viewport; this style has no empty margins. Dense tables and lists are the main content, not cards with air around them.",
    elevation:
      "None. Panes are separated by one-pixel borders. The only shadow is a glow in the accent colour on something active (`shadow-md`).",
    shapes: "Square corners everywhere. One-pixel lines. Dashed borders (`border-dashed`) for empty or pending states.",
    components: {
      button: "a compact lowercase block; the outline variant is drawn in the accent and fills on hover.",
      card: "a square bordered pane whose title is a small uppercase prompt line starting with `>`.",
      input: "a square bordered field on the screen colour, with an accent caret and an accent border on focus.",
      badge: "a tiny outlined lowercase tag.",
      tabs: "words in a row; the active one is in the accent with a rule beneath.",
      dialog: "a square pane outlined in the accent, with a glow.",
    },
    icons: "Thin line icons at 14–16px, or plain characters where a terminal would use them: `→`, `✓`, `×`, `●`.",
    dos: [
      "Align numbers and columns exactly; the monospace grid makes it easy.",
      "Prefix lines with markers a terminal would use: `>`, `$`, `#`, `[12:04:11]`.",
      "Show status with a coloured dot or a bracketed word.",
      "Add a blinking block cursor (`animate-pulse`) where the user types.",
    ],
    donts: [
      "Don't round anything or add soft drop shadows.",
      "Don't use a second typeface, even for headings.",
      "Don't leave large empty areas; fill the screen with panes.",
      "Don't use more than the one accent for emphasis.",
    ],
  },
};
