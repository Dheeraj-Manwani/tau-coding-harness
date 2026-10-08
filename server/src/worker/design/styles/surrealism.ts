import type { StyleSpec } from "../types";
import { SANS_FALLBACK, SYSTEM_MONO, variableFont } from "./fonts";

/**
 * Surrealism: the strangeness is in the pictures, so this style is built to
 * hold them. The page is a dusk sky, the panels are plain and calm, and the
 * shadows fall long and wrong, as in a painting by someone who knew the rules
 * of light and chose to bend them. The artwork itself is generated
 * (`StyleSpec.art`); what is here is the stage for it.
 */
export const surrealism: StyleSpec = {
  key: "surrealism",
  name: "Surrealism",
  look: "A dream held very still: a deep dusk sky behind calm, quiet panels, long shadows that fall the wrong way, a wide-set display face, and large, strange, painterly pictures doing the talking.",
  suits:
    "Artists, studios and galleries, music and film, a perfume or a fashion label, a magazine or a zine, a story-driven or campaign page, a launch that wants to be remembered, anything that wants a picture people stop at.",
  avoid: "Not for tools people work in all day, for dashboards, or for anything that must feel plain, quick and obvious.",
  group: "loud",
  reach: "niche",
  aka: ["Surrealist", "Dreamlike"],
  art: "A surrealist oil painting: ordinary objects placed in impossible, dreamlike relationships, a vast empty horizon, long soft shadows that fall the wrong way, hyper-real detail and a calm, uncanny mood, painterly and unhurried",

  fonts: {
    display: variableFont("Syne", "syne", SANS_FALLBACK),
    body: variableFont("Rethink Sans", "rethink-sans", SANS_FALLBACK),
    mono: SYSTEM_MONO,
  },
  fontOptions: [
    {
      key: "unbounded",
      label: "Unbounded + Urbanist",
      fonts: {
        display: variableFont("Unbounded", "unbounded", SANS_FALLBACK),
        body: variableFont("Urbanist", "urbanist", SANS_FALLBACK),
        mono: SYSTEM_MONO,
      },
    },
    {
      key: "fraunces",
      label: "Fraunces + Instrument Sans",
      fonts: {
        display: variableFont("Fraunces", "fraunces", ["ui-serif", "Georgia", "serif"].join(", "), { italic: true }),
        body: variableFont("Instrument Sans", "instrument-sans", SANS_FALLBACK),
        mono: SYSTEM_MONO,
      },
    },
  ],
  defaultMode: "dark",
  dials: { variance: 9, motion: 4, density: 2 },
  radius: "1rem",

  palette: {
    neutralHue: 290,
    chartHues: [60, -70, 130, 190],
    light: {
      background: { l: 0.95, c: 0.03 },
      surface: { l: 0.98, c: 0.018 },
      foreground: { l: 0.24, c: 0.05 },
      muted: { l: 0.92, c: 0.035 },
      mutedForeground: { l: 0.46, c: 0.05 },
      border: { l: 0.84, c: 0.045 },
      primary: { l: 0.5, c: 0.16 },
      wash: { l: 0.92, c: 0.05 },
    },
    dark: {
      background: { l: 0.2, c: 0.05 },
      surface: { l: 0.25, c: 0.05 },
      foreground: { l: 0.94, c: 0.025 },
      muted: { l: 0.29, c: 0.05 },
      mutedForeground: { l: 0.74, c: 0.045 },
      border: { l: 0.38, c: 0.06 },
      primary: { l: 0.76, c: 0.14 },
      wash: { l: 0.32, c: 0.07 },
    },
  },

  theme: {
    "--text-base": "1.0625rem",
    "--text-base--line-height": "1.7",
    "--shadow-2xs": "none",
    "--shadow-xs": "none",
    // The shadows fall a long way to one side, like a low sun in a painting.
    "--shadow-sm": "14px 10px 28px -14px color-mix(in oklab, black 40%, transparent)",
    "--shadow-md": "26px 18px 48px -20px color-mix(in oklab, black 46%, transparent)",
    "--shadow-lg": "44px 30px 70px -26px color-mix(in oklab, black 52%, transparent)",
    "--shadow-xl": "60px 40px 90px -30px color-mix(in oklab, black 58%, transparent)",
  },

  baseCss: `
  h1, h2, h3, h4 {
    font-family: var(--font-heading);
    font-weight: 600;
    letter-spacing: -0.02em;
    line-height: 1.04;
    text-wrap: balance;
  }
  h1 { font-weight: 700; letter-spacing: -0.035em; }
  p { text-wrap: pretty; }
  /* Pictures are the point: they are given room, and a soft arched corner. */
  img { border-radius: 1.25rem; }`,

  // A dusk sky, brighter near the bottom, with a pale sun sitting low on it.
  backdrop: `
      radial-gradient(34rem 22rem at 78% 100%, color-mix(in oklab, var(--chart-2) 26%, transparent), transparent 70%),
      radial-gradient(42rem 30rem at 12% 0%, color-mix(in oklab, var(--primary) 20%, transparent), transparent 70%),
      linear-gradient(180deg, transparent 55%, color-mix(in oklab, var(--chart-2) 12%, transparent) 100%)`,

  skin: {
    controlHeight: "2.875rem",
    controlPadX: "1.5rem",
    controlRadius: "9999px",
    controlText: "0.9375rem",
    borderWidth: "1px",
    buttonFont: "var(--font-heading)",
    buttonWeight: "600",
    buttonTracking: "0",
    buttonCase: "none",
    field: "filled",
    fieldRadius: "1rem",
    fieldPadX: "1.125rem",
    cardRadius: "1.75rem",
    cardPad: "2rem",
    cardBorder: "1px solid color-mix(in oklab, var(--foreground) 14%, transparent)",
    cardShadow: "var(--shadow-md)",
    cardTitleSize: "1.5rem",
    cardTitleWeight: "600",
    cardTitleTracking: "-0.02em",
    badgeRadius: "9999px",
    badgeFont: "var(--font-sans)",
    badgeCase: "none",
    badgeTracking: "0.01em",
    badgeWeight: "500",
    badgeText: "0.8125rem",
    badgePad: "0.25rem 0.875rem",
    tabs: "segmented",
    tabsRadius: "9999px",
    overlayRadius: "1.75rem",
    overlayBorder: "1px solid color-mix(in oklab, var(--foreground) 14%, transparent)",
    overlayShadow: "var(--shadow-xl)",
    labelFont: "var(--font-sans)",
    labelCase: "none",
    labelTracking: "0",
    labelText: "0.875rem",
    labelWeight: "500",
    checkRadius: "0.5rem",
    iconStroke: "1.5",
    iconSize: "1.25rem",
  },

  skinCss: `
  [data-slot="button"] { transition: transform 240ms cubic-bezier(0.2, 0.8, 0.2, 1), background-color 200ms ease; }
  [data-slot="button"][data-variant="default"]:hover { transform: translateY(-3px); }
  [data-slot="button"][data-variant="outline"] { background: transparent; border-color: color-mix(in oklab, var(--foreground) 40%, transparent); }
  [data-slot="button"][data-variant="outline"]:hover { background: var(--accent); }

  /* A panel hovers a little above the page, its shadow thrown far to one side. */
  [data-slot="card"] { transition: transform 300ms ease, box-shadow 300ms ease; }
  [data-slot="card"]:hover { transform: translateY(-4px); box-shadow: var(--shadow-lg); }
  [data-slot="card-title"] { font-family: var(--font-heading); }
  [data-slot="card-footer"] { background: transparent; border-top: 1px solid color-mix(in oklab, var(--foreground) 10%, transparent); }

  [data-slot="badge"] { background: color-mix(in oklab, var(--foreground) 9%, transparent); color: var(--foreground); border: 0; }
  [data-slot="badge"][data-variant="default"] { background: var(--primary); color: var(--primary-foreground); }`,

  layouts: [
    "poster",
    "split-hero",
    "full-bleed-bands",
    "editorial-column",
    "bento",
    "focus-column",
    "topbar-workspace",
  ],

  prose: {
    overview:
      "This app is a dream held very still. The page is a dusk sky; the panels are calm and quiet; the strangeness lives in the pictures, which are large, painterly and impossible. Nothing is busy. It should make someone stop, and then read.",
    colors:
      "A deep dusk — violet, indigo, a low glow of a warm second colour near the bottom — with light text, or a pale morning version of it. One accent for the main action and small marks. The pictures bring the rest of the colour, so everything around them stays quiet.",
    typography:
      "Headings in the wide, slightly odd display face, large, tight and heavy, in sentence case, with room around them. Text in a clean, friendly sans. A heading can sit over a picture if the picture is dark where it falls.",
    layout:
      "Give each picture a whole screen or most of one. Set one big thing and one small odd thing against a lot of empty space, off-centre. Let a picture bleed to the edge of the page, and let text sit beside it in a narrow column.",
    elevation:
      "Shadows are long and fall far to one side, as from a low sun, and are soft. Panels hover a little off the page and rise slightly when pointed at.",
    shapes:
      "Round and soft: pill-shaped buttons, generous corners on panels, arched corners on pictures. Edges are a faint one-pixel line at most.",
    components: {
      button: "a soft pill that lifts a little when pointed at.",
      card: "a calm panel with generous corners and a long soft shadow thrown to one side.",
      input: "a soft filled field with round corners.",
      badge: "a small pill on a faint ground.",
      tabs: "a pill-shaped tray with a pill for the active tab.",
      dialog: "a large softly rounded sheet with a long shadow.",
    },
    icons: "Thin line icons at 20px, used sparingly beside a word.",
    dos: [
      "Make the artwork with `generate_image`, one strong picture for the hero and one or two more: strange, calm and detailed.",
      "Describe a picture as one impossible thing in an ordinary place: a staircase to nowhere in a wheat field, a tide of clocks.",
      "Use plenty of empty space around a picture.",
      "Write short, quiet, slightly odd sentences.",
    ],
    donts: [
      "Don't crowd a screen: one picture, one idea.",
      "Don't use stock photographs or illustrations of people at laptops.",
      "Don't generate text, logos or charts in a picture.",
      "Don't use bright flat colours or hard shadows.",
    ],
  },
};
