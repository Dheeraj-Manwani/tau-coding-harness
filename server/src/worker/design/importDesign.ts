/**
 * Reading a `DESIGN.md` the user brought with them.
 *
 * The format (Google's) is YAML front matter holding design tokens, then
 * prose. The two halves end up in different places. The prose goes to the
 * agent as it is — it is the user's own description of the look, and nothing
 * tau writes would say it better. The tokens are what tau can act on without a
 * model: colours become the app's palette, font names become installed
 * typefaces, a radius becomes `--radius`.
 *
 * Files in the wild vary: some have no front matter, some name their colours
 * Material-style (`surface`, `on-surface`, `outline`), some shadcn-style
 * (`card`, `foreground`, `border`). So this reads leniently and takes only
 * what it is sure of — a hex colour under a name it recognises, a font family,
 * a length — and leaves everything else to the prose.
 *
 * Pure. See doc/CONTEXT_AND_MEMORY_PLAN.md §5, layer 2.
 */
import { hexToOklch, normalizeHex } from "./color";
import type { ImportedDesign, ImportedShapes, ImportedTokens, Mode } from "./types";

type Yaml = { [key: string]: Yaml | string };

/** The front matter and what follows it; `front` is null when there is none. */
export function splitFrontMatter(text: string): { front: string | null; body: string } {
  const normal = text.replace(/\r\n/g, "\n").replace(/^﻿/, "");
  if (!normal.startsWith("---\n")) return { front: null, body: normal };
  const end = normal.indexOf("\n---", 4);
  if (end === -1) return { front: null, body: normal };
  const after = normal.indexOf("\n", end + 1);
  return {
    front: normal.slice(4, end),
    body: after === -1 ? "" : normal.slice(after + 1),
  };
}

/**
 * The small part of YAML these files use: nested `key: value` maps, by
 * indentation. Lists, multi-line strings and anchors are skipped rather than
 * mis-read.
 */
function parseYamlMaps(front: string): Yaml {
  const root: Yaml = {};
  const stack: { indent: number; map: Yaml }[] = [{ indent: -1, map: root }];

  for (const raw of front.split("\n")) {
    if (!raw.trim() || raw.trim().startsWith("#") || raw.trim().startsWith("- ")) continue;
    const m = /^(\s*)(["']?)([^"':#][^:]*?)\2\s*:\s*(.*)$/.exec(raw);
    if (!m) continue;
    const indent = m[1]!.length;
    const key = m[3]!.trim();
    let value = m[4]!.trim();

    while (stack.length > 1 && indent <= stack[stack.length - 1]!.indent) stack.pop();
    const parent = stack[stack.length - 1]!.map;

    if (value === "" || value === "|" || value === ">") {
      const child: Yaml = {};
      parent[key] = child;
      stack.push({ indent, map: child });
      continue;
    }
    // Drop a trailing comment, then the quotes.
    if (!/^["']/.test(value)) value = value.replace(/\s+#.*$/, "");
    parent[key] = value.replace(/^(["'])(.*)\1$/, "$2");
  }
  return root;
}

function mapOf(value: Yaml | string | undefined): Yaml | null {
  return value !== undefined && typeof value !== "string" ? value : null;
}

/** Every leaf of a nested map, with its path joined by `-`. */
function leaves(map: Yaml, prefix = ""): [string, string][] {
  const out: [string, string][] = [];
  for (const [key, value] of Object.entries(map)) {
    const path = (prefix ? `${prefix}-${key}` : key).toLowerCase().replace(/[_\s]+/g, "-");
    if (typeof value === "string") out.push([path, value]);
    else out.push(...leaves(value, path));
  }
  return out;
}

/**
 * What a colour name in someone else's file means in this app's palette.
 * Checked in order, first match wins, so the specific names come before the
 * general ones.
 */
const COLOR_NAMES: [RegExp, string][] = [
  [/^(on-primary|primary-foreground|primary-on|on-brand)$/, "primary-foreground"],
  [/^(primary|brand|brand-primary|primary-default|primary-500)$/, "primary"],
  [/^(on-background|foreground|text|text-primary|ink|on-bg|body)$/, "foreground"],
  [/^(background|bg|canvas|page|background-default|surface-page)$/, "background"],
  [/^(on-surface|card-foreground|on-card)$/, "card-foreground"],
  [/^(surface|card|paper|panel|surface-default|surface-card|elevated)$/, "card"],
  [/^(on-muted|muted-foreground|on-surface-variant|text-muted|text-secondary|secondary-text|subtle-text)$/, "muted-foreground"],
  [/^(muted|surface-variant|surface-muted|subtle|surface-container|neutral-100)$/, "muted"],
  [/^(border|outline|outline-variant|divider|hairline|stroke|line)$/, "border"],
  [/^(destructive|error|danger|negative)$/, "destructive"],
];

/** A typography entry's role, from its name. */
const FONT_ROLES: [RegExp, "display" | "body" | "mono"][] = [
  [/(mono|code)/, "mono"],
  [/(display|headline|heading|title|hero|h1|h2)/, "display"],
  [/(body|paragraph|text|copy|base|default|label)/, "body"],
];

/** `"Playfair Display", Georgia, serif` → `Playfair Display`. */
function familyName(value: string): string | null {
  const first = value.split(",")[0]!.trim().replace(/^["']|["']$/g, "").replace(/\s+Variable$/i, "");
  if (!first || /^(serif|sans-serif|monospace|system-ui|inherit|ui-[a-z-]+)$/i.test(first)) return null;
  return /^[\p{L}\p{N} .'-]{2,60}$/u.test(first) ? first : null;
}

const LENGTH = /^(?:0|\d+(?:\.\d+)?(?:px|rem|em))$/;

function word<T extends string>(value: Yaml | string | undefined, allowed: readonly T[]): T | undefined {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}

/**
 * How the file says its components are shaped: the corner of a control and of
 * a card, from its radius scale, and the rest from a `shapes` map. That map is
 * tau's own addition to the format — a file from another tool will not have
 * one, and loses nothing by it.
 */
function importedShapes(yaml: Yaml, rounded: Yaml | null): ImportedShapes | undefined {
  const shapes: ImportedShapes = {};
  if (rounded) {
    // "0px" is square and "999px" is a pill, however each file spells them.
    const plain = (value: string) =>
      /^0(?:px|rem|em)?$/.test(value) ? "0" : /^\d{3,}px$/.test(value) ? "9999px" : value;
    const radii = new Map(
      leaves(rounded)
        .filter(([, value]) => LENGTH.test(value))
        .map(([name, value]) => [name, plain(value)] as const),
    );
    const control = radii.get("control") ?? radii.get("button") ?? radii.get("buttons");
    const card = radii.get("card") ?? radii.get("cards") ?? radii.get("panel");
    if (control) shapes.control = control;
    if (card) shapes.card = card;
  }
  const said = mapOf(yaml.shapes);
  if (said) {
    const borders = word(said.borders, ["none", "hairline", "thick"] as const);
    const shadows = word(said.shadows, ["none", "soft", "hard"] as const);
    const fields = word(said.fields, ["outlined", "underline", "filled"] as const);
    const labels = word(said.labels, ["none", "uppercase"] as const);
    if (borders) shapes.borders = borders;
    if (shadows) shapes.shadows = shadows;
    if (fields) shapes.fields = fields;
    if (labels) shapes.labels = labels;
  }
  return Object.keys(shapes).length > 0 ? shapes : undefined;
}

/** The tokens tau can use from a file's front matter. Empty when it has none. */
export function importedTokens(front: string | null): ImportedTokens {
  const tokens: ImportedTokens = { colors: {}, fonts: {} };
  if (!front) return tokens;
  const yaml = parseYamlMaps(front);

  const colors = mapOf(yaml.colors) ?? mapOf(yaml.colours) ?? mapOf(yaml.color);
  let accent: string | null = null;
  if (colors) {
    for (const [name, value] of leaves(colors)) {
      const hex = normalizeHex(value);
      if (!hex) continue;
      if (name === "accent" || name === "secondary") accent ??= hex;
      const target = COLOR_NAMES.find(([re]) => re.test(name))?.[1];
      if (target && !tokens.colors[target]) tokens.colors[target] = hex;
    }
  }
  // A file with an accent and no primary means its accent is the brand colour.
  if (!tokens.colors.primary && accent) tokens.colors.primary = accent;

  const typography = mapOf(yaml.typography) ?? mapOf(yaml.fonts) ?? mapOf(yaml.type);
  if (typography) {
    for (const [name, value] of leaves(typography)) {
      if (!/(^|-)(fontfamily|font-family|family|font)$/.test(name) && name.includes("-")) continue;
      const family = familyName(value);
      if (!family) continue;
      const role = FONT_ROLES.find(([re]) => re.test(name))?.[1];
      if (role && !tokens.fonts[role]) tokens.fonts[role] = family;
    }
  }

  const rounded = mapOf(yaml.rounded) ?? mapOf(yaml.radius) ?? mapOf(yaml.radii);
  if (rounded) {
    const all = leaves(rounded).filter(([, value]) => LENGTH.test(value));
    const pick =
      all.find(([name]) => /^(base|md|medium|default)$/.test(name)) ??
      all.find(([name]) => /^(lg|card|control|sm)$/.test(name));
    if (pick) tokens.radius = pick[1];
  } else if (typeof yaml.radius === "string" && LENGTH.test(yaml.radius)) {
    tokens.radius = yaml.radius;
  }

  const shapes = importedShapes(yaml, rounded);
  if (shapes) tokens.shapes = shapes;

  const density = typeof yaml.density === "string" ? Number(yaml.density) : NaN;
  if (Number.isInteger(density) && density >= 1 && density <= 10) tokens.density = density;

  return tokens;
}

/** Whether a file's front matter says tau wrote it from a screenshot (`fromImage.ts`). */
function readFromImage(front: string | null): boolean {
  return front !== null && /^source:\s*["']?screenshot["']?\s*$/m.test(front);
}

/** Read a file the user brought. Never throws: a file with nothing usable has empty tokens. */
export function parseImportedDesign(text: string): ImportedDesign {
  const { front } = splitFrontMatter(text);
  return {
    text: text.replace(/\r\n/g, "\n").trim(),
    tokens: importedTokens(front),
    ...(readFromImage(front) ? { fromImage: true } : {}),
  };
}

/** Whether the imported page colour is a dark one; null when the file gives none. */
export function importedMode(tokens: ImportedTokens): Mode | null {
  const background = tokens.colors.background;
  if (!background) return null;
  return hexToOklch(background).l < 0.5 ? "dark" : "light";
}

/** `Playfair Display` → `playfair-display`, the way Fontsource names its packages. */
export function fontSlug(family: string): string {
  return family
    .toLowerCase()
    .normalize("NFKD")
    // The accents an NFKD split leaves behind, so "ö" becomes "o", not "o-".
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
