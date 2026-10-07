import type { StyleSpec } from "../types";
import { MONO_FALLBACK, SANS_FALLBACK, staticFont, variableFont } from "./fonts";

const plex = variableFont("IBM Plex Sans", "ibm-plex-sans", SANS_FALLBACK);

export const workbench: StyleSpec = {
  key: "workbench",
  name: "Workbench",
  look: "A professional's tool: dense, neutral and tabular, with compact controls, thin borders and nothing decorative.",
  suits:
    "Admin panels, internal tools, CRMs, inventory, back-office and operations dashboards, data-heavy apps used all day by people who know them well.",
  avoid: "Not for marketing pages, or for anything that has to charm a first-time visitor.",
  group: "precise",
  reach: "general",

  fonts: {
    display: plex,
    body: plex,
    mono: staticFont("IBM Plex Mono", "ibm-plex-mono", [400, 500, 600], MONO_FALLBACK),
  },
  fontOptions: [
    {
      key: "source",
      label: "Source Sans 3 + Source Code Pro",
      fonts: {
        display: variableFont("Source Sans 3", "source-sans-3", SANS_FALLBACK),
        body: variableFont("Source Sans 3", "source-sans-3", SANS_FALLBACK),
        mono: variableFont("Source Code Pro", "source-code-pro", MONO_FALLBACK),
      },
    },
    {
      key: "public",
      label: "Public Sans + Red Hat Mono",
      fonts: {
        display: variableFont("Public Sans", "public-sans", SANS_FALLBACK),
        body: variableFont("Public Sans", "public-sans", SANS_FALLBACK),
        mono: variableFont("Red Hat Mono", "red-hat-mono", MONO_FALLBACK),
      },
    },
  ],
  defaultMode: "light",
  dials: { variance: 3, motion: 2, density: 9 },
  radius: "0.375rem",

  palette: {
    neutralHue: 255,
    chartHues: [150, 60, 210, -60],
    light: {
      background: { l: 0.985, c: 0.003 },
      surface: { l: 1, c: 0 },
      foreground: { l: 0.21, c: 0.012 },
      muted: { l: 0.957, c: 0.005 },
      mutedForeground: { l: 0.5, c: 0.012 },
      border: { l: 0.895, c: 0.006 },
      primary: { l: 0.5, c: 0.18 },
      wash: { l: 0.95, c: 0.025 },
    },
    dark: {
      background: { l: 0.17, c: 0.006 },
      surface: { l: 0.2, c: 0.007 },
      foreground: { l: 0.94, c: 0.006 },
      muted: { l: 0.245, c: 0.008 },
      mutedForeground: { l: 0.7, c: 0.012 },
      border: { l: 0.3, c: 0.01 },
      primary: { l: 0.68, c: 0.15 },
      wash: { l: 0.27, c: 0.035 },
    },
  },

  theme: {
    "--text-xs": "0.6875rem",
    "--text-sm": "0.8125rem",
    "--text-base": "0.875rem",
    "--text-base--line-height": "1.5",
    "--text-lg": "1rem",
    "--shadow-2xs": "none",
    "--shadow-xs": "0 1px 1px 0 rgb(0 0 0 / 0.04)",
    "--shadow-sm": "0 1px 2px 0 rgb(0 0 0 / 0.08)",
    "--shadow-md": "0 4px 12px -4px rgb(0 0 0 / 0.14)",
    "--shadow-lg": "0 12px 32px -12px rgb(0 0 0 / 0.24)",
    "--shadow-xl": "0 20px 48px -16px rgb(0 0 0 / 0.3)",
  },

  baseCss: `
  h1, h2, h3, h4 {
    font-family: var(--font-heading);
    font-weight: 600;
    letter-spacing: -0.01em;
    line-height: 1.25;
  }
  body { font-feature-settings: "tnum"; }`,

  skin: {
    controlHeight: "2rem",
    controlPadX: "0.75rem",
    controlRadius: "0.375rem",
    controlText: "0.8125rem",
    borderWidth: "1px",
    buttonFont: "var(--font-sans)",
    buttonWeight: "500",
    buttonTracking: "0",
    buttonCase: "none",
    field: "outlined",
    fieldRadius: "0.375rem",
    fieldPadX: "0.625rem",
    cardRadius: "0.5rem",
    cardPad: "1rem",
    cardBorder: "1px solid var(--border)",
    cardShadow: "var(--shadow-xs)",
    cardTitleSize: "0.875rem",
    cardTitleWeight: "600",
    cardTitleTracking: "0",
    badgeRadius: "0.25rem",
    badgeFont: "var(--font-mono)",
    badgeCase: "none",
    badgeTracking: "0",
    badgeWeight: "500",
    badgeText: "0.6875rem",
    badgePad: "0.0625rem 0.375rem",
    tabs: "underline",
    tabsRadius: "0",
    overlayRadius: "0.5rem",
    overlayBorder: "1px solid var(--border)",
    overlayShadow: "var(--shadow-lg)",
    labelFont: "var(--font-sans)",
    labelCase: "none",
    labelTracking: "0",
    labelText: "0.75rem",
    labelWeight: "500",
    checkRadius: "0.1875rem",
    iconStroke: "1.75",
    iconSize: "1rem",
  },

  skinCss: `
  [data-slot="input"], [data-slot="textarea"], [data-slot="select-trigger"] { background: var(--card); }
  [data-slot="button"][data-variant="outline"] { background: var(--card); box-shadow: var(--shadow-xs); }
  [data-slot="card-footer"] { background: var(--muted); }

  /* Tables are the main content here: tight rows, quiet headers, hover to track a row. */
  [data-slot="table-head"] {
    height: 2rem;
    background: var(--muted);
    color: var(--muted-foreground);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: 0.6875rem;
  }
  [data-slot="table-cell"] { padding-block: 0.375rem; }
  [data-slot="badge"][data-variant="secondary"], [data-slot="badge"][data-variant="outline"] {
    background: var(--muted);
    border-color: var(--border);
  }`,

  layouts: [
    "sidebar-shell",
    "dashboard-grid",
    "master-detail",
    "topbar-workspace",
    "split-tool",
    "board",
    "focus-column",
    "split-hero",
    "index-list",
  ],

  prose: {
    overview:
      "This app is a tool for people doing a job. It is dense, quiet and predictable: compact controls, small text, thin borders, a lot on screen at once. Its quality shows in how easy it is to scan and how little it gets in the way, not in decoration.",
    colors:
      "Neutral greys with a cool cast, white panels, and one accent that marks the primary action, the current selection and links. Colour otherwise carries meaning only: the chart colours for status and categories, red for destructive actions.",
    typography:
      "One workmanlike sans at small sizes — 13–14px body, 11–12px labels. Numbers are tabular everywhere and right-aligned in columns. IDs, codes, timestamps and amounts go in the monospace face. Headings are only slightly larger than body and semibold; this style has no large type.",
    layout:
      "Fill the viewport and put navigation, filters and content all on screen together. Tables and lists are the default way to show things; a card is for a summary figure or a form section. Keep toolbars — search, filters, bulk actions — directly above what they act on.",
    elevation:
      "Almost flat. Panels have a thin border and the faintest shadow; menus and dialogs have a real one. Use background shade, not shadow, to show what is selected.",
    shapes: "Small radii — 6px on controls, 8px on panels — and one-pixel borders in light grey.",
    components: {
      button: "a compact 32px block with a medium-weight label; the outline variant is white with a thin border.",
      card: "a white panel with a thin border, tight padding and a small semibold title.",
      input: "a compact white field with a thin border.",
      badge: "a small squared monospace tag, usually grey; coloured only to show status.",
      tabs: "words in a row with a rule under the active one.",
      dialog: "a compact panel with a thin border and a clear shadow.",
    },
    icons: "Line icons at 16px inside buttons and beside menu items. Every icon-only button needs a tooltip.",
    dos: [
      "Use a table when there are more than a handful of similar items.",
      "Show counts, totals and status at a glance in a compact row above the main content.",
      "Give every list a search or filter once it can exceed a screen.",
      "Keep row heights tight and consistent.",
    ],
    donts: [
      "Don't use large headings, hero sections or decorative imagery.",
      "Don't spread a few values across big cards with empty space.",
      "Don't use colour for decoration; it means something here.",
      "Don't hide common actions in menus when there is room to show them.",
    ],
  },
};
