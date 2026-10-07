/**
 * `.tau/DESIGN.md`: an app's design, written down.
 *
 * The file follows Google's DESIGN.md format — YAML front matter holding the
 * design tokens, then prose sections in a fixed order (Overview, Colors,
 * Typography, Layout, Elevation & Depth, Shapes, Components, Do's and Don'ts)
 * — so it can be handed to, or taken from, any other tool that reads the
 * format.
 *
 * The two halves have different readers. The front matter is for tools: exact
 * values, duplicated from `src/index.css`, which is what the app actually
 * runs on. The prose is for the agent, and is what tau attaches to every
 * request (`designProse`): what the look is, why, and what to do and not do
 * with it. The values are left out of what the agent is sent — it reads them
 * from the CSS when it needs one, and they would cost tokens on every turn
 * otherwise.
 *
 * Pure. See doc/CONTEXT_AND_MEMORY_PLAN.md §5.
 */
import type { Theme } from "../templates/theme";
import { normalizeHex } from "./color";
import { spacingUnit } from "./css";
import { splitFrontMatter } from "./importDesign";
import { LAYOUTS } from "./layouts";
import type { DesignChoice, Dials, StyleSpec } from "./types";

export const DESIGN_PATH = ".tau/DESIGN.md";

/** The prose is handed over whole on every request, so it has to stay small. */
export const DESIGN_PROSE_MAX_CHARS = 6_000;

function level(value: number, low: string, mid: string, high: string): string {
  return value <= 3 ? low : value <= 6 ? mid : high;
}

/** The three dials as sentences an agent can act on. */
export function describeDials(dials: Dials): string[] {
  return [
    `**Variance ${dials.variance}/10** — ${level(
      dials.variance,
      "keep compositions symmetric and predictable: aligned columns, even rhythm.",
      "mostly aligned, with one deliberate asymmetry per screen — an unequal split, an element that breaks the column.",
      "compose asymmetrically: unequal columns, overlapping elements, things placed off-centre on purpose.",
    )}`,
    `**Motion ${dials.motion}/10** — ${level(
      dials.motion,
      "almost still: quick colour and opacity changes on hover and focus, nothing else.",
      "content eases in as it appears and controls respond to touch; nothing loops or draws attention to itself.",
      "lively: staggered entrances, things that spring and settle, feedback on every interaction.",
    )}`,
    `**Density ${dials.density}/10** — ${level(
      dials.density,
      "airy: few things per screen, wide gaps, generous padding.",
      "balanced: comfortable gaps, a moderate amount on screen.",
      "packed: tight rows, small gaps, as much on screen as stays readable.",
    )}`,
  ];
}

function yamlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function frontMatter(style: StyleSpec, choice: DesignChoice, theme: Theme): string {
  const p = choice.mode === "dark" ? theme.dark : theme.light;
  const family = (stack: string) => stack.split(",")[0]!.replace(/"/g, "").trim();
  const v = style.skin;

  return `---
version: alpha
name: ${yamlString(style.name)}
description: ${yamlString(choice.read)}
colors:
  primary: "${p.primary}"
  on-primary: "${p["primary-foreground"]}"
  background: "${p.background}"
  on-background: "${p.foreground}"
  surface: "${p.card}"
  on-surface: "${p["card-foreground"]}"
  muted: "${p.muted}"
  on-muted: "${p["muted-foreground"]}"
  accent: "${p.accent}"
  border: "${p.border}"
  destructive: "${p.destructive}"
typography:
  display:
    fontFamily: ${yamlString(family(style.fonts.display.stack))}
    fontWeight: ${v.cardTitleWeight}
  body:
    fontFamily: ${yamlString(family(style.fonts.body.stack))}
    fontSize: ${style.theme["--text-base"] ?? "1rem"}
  label:
    fontFamily: ${yamlString(family(style.fonts.body.stack))}
    fontSize: ${v.labelText}
    letterSpacing: ${v.labelTracking === "0" ? "0em" : v.labelTracking}
  mono:
    fontFamily: ${yamlString(family(style.fonts.mono.stack))}
rounded:
  base: ${theme.radius}
  control: ${v.controlRadius === "0" ? "0px" : v.controlRadius}
  card: ${v.cardRadius === "0" ? "0px" : v.cardRadius}
spacing:
  unit: ${spacingUnit(choice.dials.density)}
  control-height: ${v.controlHeight}
  card-padding: ${v.cardPad}
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.control}"
    height: "{spacing.control-height}"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.card}"
    padding: "{spacing.card-padding}"
---`;
}

/**
 * The comment that records how the design was chosen, for tools that read it
 * back: a restyle starts from these values, and the theme panel shows them.
 */
function metaComment(choice: DesignChoice, stamp?: string): string {
  const d = choice.dials;
  const extra = [
    choice.fonts ? ` fonts=${choice.fonts}` : "",
    choice.source === "user" || choice.source === "import" ? ` source=${choice.source}` : "",
    stamp ? ` base=${stamp}` : "",
  ].join("");
  return `<!-- tau: style=${choice.style} mode=${choice.mode} accent=${choice.accent} variance=${d.variance} motion=${d.motion} density=${d.density}${extra} -->`;
}

/**
 * Whether a line of a `DESIGN.md` is one whose content depends on something
 * other than the style, the mode, the dials and the fonts: tau's own record,
 * the sentence describing the app, and the line naming colours the theme
 * panel can change.
 */
export function isVolatileLine(line: string): boolean {
  return (
    line.startsWith("<!-- tau:") ||
    line.startsWith("- The accent is `") ||
    line.startsWith("Reading this as:")
  );
}

/**
 * A fingerprint of the prose tau wrote into a file, recorded in the file.
 *
 * It answers one question later: is what tau would write for this design
 * today the same as what it wrote then? If so, any line of the file that tau
 * would not write was added by someone, and a restyle can keep exactly those
 * lines. If tau's wording has changed since, that comparison would mistake
 * tau's own old sentences for someone's notes — and the stamp says not to
 * make it.
 */
export function proseStamp(designMd: string): string {
  const { body } = splitFrontMatter(designMd);
  let h = 2166136261;
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line || isVolatileLine(line)) continue;
    for (let i = 0; i < line.length; i++) {
      h ^= line.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h ^= 10;
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** The line that states the three colours an agent most needs to know. */
function accentLine(primary: string, background: string, foreground: string): string {
  return `- The accent is \`${primary}\` (\`bg-primary\`, \`text-primary\`). The page is \`${background}\`, text is \`${foreground}\`.`;
}

const TOKEN_RULE =
  "- Colour only through tokens: `bg-background`, `bg-card`, `bg-muted`, `bg-primary`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-chart-1` … `bg-chart-5`. Never a literal colour in a component.";

/** The whole file, ending in a newline. */
export function renderDesignMd(
  style: StyleSpec,
  choice: DesignChoice,
  theme: Theme,
): string {
  const p = choice.mode === "dark" ? theme.dark : theme.light;
  const other = choice.mode === "dark" ? "light" : "dark";
  const { fonts, prose } = style;
  const sameFace = fonts.display.name === fonts.body.name;

  const typeLines = sameFace
    ? [`- **${fonts.body.name}** for everything — \`font-sans\`. Headings use it automatically.`]
    : [
        `- Display: **${fonts.display.name}** — headings use it automatically; elsewhere, \`font-heading\`.`,
        `- Body: **${fonts.body.name}** — \`font-sans\`, the default.`,
      ];
  if (fonts.mono.name !== fonts.body.name) {
    typeLines.push(
      `- Mono: ${fonts.mono.pkg ? `**${fonts.mono.name}**` : fonts.mono.name} — \`font-mono\`.`,
    );
  }

  const layouts = style.layouts
    .map((key) => `- **${LAYOUTS[key].name}** — ${LAYOUTS[key].summary}`)
    .join("\n");

  const c = prose.components;
  const stampAt = "<!-- tau:stamp -->";

  const file = `${frontMatter(style, choice, theme)}
${stampAt}

# Design — ${style.name}

## Overview
${choice.read}

${prose.overview}

${describeDials(choice.dials).map((line) => `- ${line}`).join("\n")}

## Colors
${prose.colors}

${accentLine(p.primary, p.background, p.foreground)}
- The app opens in ${choice.mode} mode. A ${other} palette is defined too, so both must keep working.
${TOKEN_RULE}

## Typography
${typeLines.join("\n")}

${prose.typography}

## Layout
${prose.layout}

Build each screen on one of these structures, chosen for what the screen holds:
${layouts}

## Elevation & Depth
${prose.elevation}

## Shapes
${prose.shapes}

## Components
The shadcn components are already restyled for this look by the skin in \`src/index.css\`. Use them as they are, and do not add radius, border, shadow, font or height classes to them — the skin decides those.

- **Button** — ${c.button}
- **Card** — ${c.card}
- **Input** — ${c.input}
- **Badge** — ${c.badge}
- **Tabs** — ${c.tabs}
- **Dialog** — ${c.dialog}
- **Icons** — ${prose.icons}

## Do's and Don'ts
${prose.dos.map((line) => `- Do: ${line}`).join("\n")}
${prose.donts.map((line) => `- ${line}`).join("\n")}
`;
  return file.replace(stampAt, metaComment(choice, proseStamp(file)));
}

/**
 * `.tau/DESIGN.md` for an app built around a design the user brought.
 *
 * Their file is kept whole — front matter and prose — because it is theirs and
 * says what they want better than a paraphrase would. Ahead of their prose
 * goes one short section of tau's own: how the design was built into this
 * particular app (the tokens, the skin, the typefaces that could actually be
 * installed), which their file cannot know. It goes first because the agent is
 * sent only the start of a long file, and these are the lines that keep it
 * inside the stylesheet.
 */
export function renderImportedDesignMd(
  style: StyleSpec,
  choice: DesignChoice,
  theme: Theme,
): string {
  const p = choice.mode === "dark" ? theme.dark : theme.light;
  const other = choice.mode === "dark" ? "light" : "dark";
  const { front, body } = splitFrontMatter(choice.imported?.text ?? "");
  const theirs = body.replace(/^<!-- tau:[^\n]*-->\n?/m, "").trim();
  const { fonts } = style;
  const layouts = style.layouts.map((key) => LAYOUTS[key].name).join(", ");

  return `${front !== null ? `---\n${front}\n---\n` : ""}${metaComment(choice)}

## In this app
tau built this design into the app. Its colours are the palette in \`src/index.css\`, and the shadcn components are reshaped by a skin there based on tau's ${style.name} style, the closest match to what is described below.

${accentLine(p.primary, p.background, p.foreground)}
- The app opens in ${choice.mode} mode. A ${other} palette is defined too, so both must keep working.
${TOKEN_RULE}
- Typefaces: headings use **${fonts.display.name}** (\`font-heading\`), text is **${fonts.body.name}** (\`font-sans\`), and \`font-mono\` is ${fonts.mono.name}. Where the design below names a typeface that is not one of these, it could not be installed; use these.
- Use the shadcn components as they are, and do not add radius, border, shadow, font or height classes to a Button, Card, Input, Badge, Tabs or Dialog — the skin decides those.
${describeDials(choice.dials).map((line) => `- ${line}`).join("\n")}
- Where the design below does not say how to arrange a screen, build it on one of: ${layouts}.

Everything below this line is the design as the user wrote it. Follow it.

${theirs}
`;
}

/** The front-matter colour names tau writes, and the theme variable each mirrors. */
const FRONT_MATTER_COLORS: [string, string][] = [
  ["primary", "--primary"],
  ["on-primary", "--primary-foreground"],
  ["background", "--background"],
  ["on-background", "--foreground"],
  ["surface", "--card"],
  ["muted", "--muted"],
  ["on-muted", "--muted-foreground"],
  ["accent", "--accent"],
  ["border", "--border"],
  ["destructive", "--destructive"],
];

/**
 * Bring a `DESIGN.md` back into line with the stylesheet after the theme
 * panel has changed it.
 *
 * The panel edits `src/index.css`, which is what the app runs on. The agent
 * reads `DESIGN.md`, which still named the old accent — so the next request
 * would be built to a colour the user had just replaced. This rewrites the
 * places the file states those values: the colours in the front matter, the
 * base radius, the line of prose that names the accent, and tau's own record
 * of the accent.
 *
 * Splices values and leaves everything else as it was, so anything the agent
 * or the user has added to the file survives. A value the file does not state
 * is not added.
 *
 * @param tokens  the palette the app opens in, as theme variables
 *                (`--primary` → `#…`), plus `--radius` if known
 */
export function syncDesignMd(designMd: string, tokens: Readonly<Record<string, string>>): string {
  const text = designMd.replace(/\r\n/g, "\n");
  const hex = (name: string) => normalizeHex(tokens[name]);

  let front = "";
  let rest = text;
  if (text.startsWith("---\n")) {
    const end = text.indexOf("\n---", 4);
    if (end !== -1) {
      front = text.slice(0, end);
      rest = text.slice(end);
    }
  }

  for (const [key, variable] of FRONT_MATTER_COLORS) {
    const value = hex(variable);
    if (!value) continue;
    front = front.replace(
      new RegExp(`^(  ${key}: )"#[0-9a-fA-F]{3,8}"$`, "m"),
      `$1"${value}"`,
    );
  }
  const radius = tokens["--radius"];
  if (radius && /^(?:0|\d+(?:\.\d+)?(?:rem|px|em))$/.test(radius)) {
    front = front.replace(/^(rounded:\n  base: ).*$/m, `$1${radius}`);
  }

  const primary = hex("--primary");
  const background = hex("--background");
  const foreground = hex("--foreground");
  if (primary) {
    rest = rest.replace(/(<!-- tau:[^\n]*?\baccent=)#[0-9a-fA-F]{3,8}/, `$1${primary}`);
  }
  rest = rest.replace(
    /^- The accent is `(#[0-9a-fA-F]{3,8})` \(`bg-primary`, `text-primary`\)\. The page is `(#[0-9a-fA-F]{3,8})`, text is `(#[0-9a-fA-F]{3,8})`\.$/m,
    (_line, a: string, b: string, c: string) =>
      accentLine(primary ?? a, background ?? b, foreground ?? c),
  );

  return front + rest;
}

/**
 * The part of a DESIGN.md an agent is sent: the prose, without the front
 * matter's token values or tau's bookkeeping comment.
 *
 * Works on any file in the format, not only ones tau wrote — a user may
 * replace theirs with one from another tool.
 */
export function designProse(designMd: string): string {
  let body = designMd.replace(/\r\n/g, "\n");
  if (body.startsWith("---\n")) {
    const end = body.indexOf("\n---", 4);
    if (end !== -1) body = body.slice(body.indexOf("\n", end + 1) + 1);
  }
  body = body.replace(/^<!-- tau:[^\n]*-->\n?/m, "").trim();
  if (body.length <= DESIGN_PROSE_MAX_CHARS) return body;
  return `${body.slice(0, DESIGN_PROSE_MAX_CHARS)}\n\n[The rest of ${DESIGN_PATH} is cut here to save space; read the file for the remainder.]`;
}

/** What tau recorded about how a design was chosen, if the file still says. */
export function readDesignMeta(designMd: string): Record<string, string> | null {
  const m = /<!-- tau:([^\n]*?)-->/.exec(designMd);
  if (!m) return null;
  const out: Record<string, string> = {};
  for (const pair of m[1]!.trim().split(/\s+/)) {
    const eq = pair.indexOf("=");
    if (eq > 0) out[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return out;
}
