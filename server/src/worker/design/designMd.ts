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
import { spacingUnit } from "./css";
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

/** The comment that records how the design was chosen, for tools that read it back. */
function metaComment(choice: DesignChoice): string {
  const d = choice.dials;
  return `<!-- tau: style=${choice.style} mode=${choice.mode} accent=${choice.accent} variance=${d.variance} motion=${d.motion} density=${d.density} -->`;
}

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

  return `${frontMatter(style, choice, theme)}
${metaComment(choice)}

# Design — ${style.name}

## Overview
${choice.read}

${prose.overview}

${describeDials(choice.dials).map((line) => `- ${line}`).join("\n")}

## Colors
${prose.colors}

- The accent is \`${p.primary}\` (\`bg-primary\`, \`text-primary\`). The page is \`${p.background}\`, text is \`${p.foreground}\`.
- The app opens in ${choice.mode} mode. A ${other} palette is defined too, so both must keep working.
- Colour only through tokens: \`bg-background\`, \`bg-card\`, \`bg-muted\`, \`bg-primary\`, \`text-foreground\`, \`text-muted-foreground\`, \`border-border\`, \`bg-chart-1\` … \`bg-chart-5\`. Never a literal colour in a component.

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
