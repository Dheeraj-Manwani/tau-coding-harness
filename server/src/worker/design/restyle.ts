/**
 * Changing the look of an app that already exists.
 *
 * A new app's design is two generated files, and a restyle generates them
 * again from a different choice. That part is free. What makes a restyle
 * harder than a first design is that the app has a history: the agent has
 * added a token for a sale banner, the user asked for a script font on one
 * heading, someone wrote into `DESIGN.md` that the logo must stay green. A
 * restyle that regenerated the two files and stopped would silently delete all
 * of it, and the app would break in places nobody was looking at.
 *
 * So a restyle regenerates what tau owns and carries over what it does not:
 *
 *   - in `src/index.css`, tau owns the palette values, the theme tokens, the
 *     base rules and the skin. Anything else — a variable tau never declares,
 *     an extra `@import`, a rule outside tau's blocks — is the app's, and is
 *     kept (`carryOverCss`);
 *   - in `.tau/DESIGN.md`, tau owns the lines it wrote, which the file keeps
 *     a record of. The notes section and any other line were added since, and
 *     are kept as the new file's notes (`keptNotes`).
 *
 * What a restyle deliberately does not keep is a change made *inside* what tau
 * owns — a palette colour edited in the theme panel, a rule changed within the
 * skin. Those are the old look, and replacing the look is the request.
 *
 * Pure. See doc/CONTEXT_AND_MEMORY_PLAN.md §5.
 */
import { describeDesign, type DesignSummary } from "./config";
import {
  NOTES_HEADING,
  NOTES_INTRO,
  isVolatileLine,
  lineMark,
  splitNotes,
  writtenLines,
} from "./designMd";
import { splitFrontMatter } from "./importDesign";
import {
  ALL_STYLES,
  DEFAULT_FONTS,
  GENERAL_STYLES,
  STYLES,
  allFontPackages,
  chosenPairing,
  isFontPairing,
} from "./styles";
import type { DesignChoice, DesignConfig, ImportedDesign } from "./types";

// ── The new choice ───────────────────────────────────────────────────────────

/** The "Reading this as …" sentence a tau-written file was built from, if it still says. */
export function readOf(designMd: string | null | undefined): string | null {
  if (!designMd) return null;
  const { front, body } = splitFrontMatter(designMd);
  const described = front ? /^description:\s*"((?:[^"\\]|\\.)*)"\s*$/m.exec(front)?.[1] : null;
  if (described) return described.replace(/\\(["\\])/g, "$1");
  return /^Reading this as: .+$/m.exec(body)?.[0] ?? null;
}

/**
 * The design to change to: what the user asked for, with everything they did
 * not mention carried over from how the app looks now.
 *
 * No model is involved — the user is choosing, not asking tau to. Two things
 * follow a change of style rather than staying put, because they belong to a
 * style: light or dark (someone who picks a night-time style expects it to
 * open dark) and the three dials. A colour carries over, refitted to the new
 * style; a colour the user names in this request is used exactly.
 *
 * @param current   the app's design now, or null when it has none tau can read
 * @param read      the "Reading this as …" sentence to keep
 * @param imported  a design the user brought with this request
 * @param seed      the project id, for an app with no design to start from
 */
export function restyledChoice(
  current: DesignSummary | null,
  config: DesignConfig,
  read: string | null,
  seed: string,
  imported?: ImportedDesign,
): DesignChoice {
  const key =
    config.style ??
    current?.style ??
    GENERAL_STYLES[[...seed].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % GENERAL_STYLES.length]!.key;
  const style = STYLES[key];
  const sameStyle = current?.style === key;

  const given = config.accent ?? imported?.tokens.colors.primary;
  // A pairing named in the request — the style's own included — is the
  // pairing. Otherwise an app keeps the one it has, while it keeps its style.
  const fonts = isFontPairing(style, config.fonts)
    ? chosenPairing(style, config.fonts)
    : sameStyle && current.fonts !== DEFAULT_FONTS
      ? current.fonts
      : undefined;

  const neutral =
    config.neutral === "style" ? undefined : (config.neutral ?? current?.neutral ?? undefined);

  return {
    style: key,
    accent: given ?? current?.accent ?? "#4d7c0f",
    accentExact: given !== undefined,
    mode: config.mode ?? (sameStyle ? current.mode : style.defaultMode),
    dials: {
      ...(sameStyle ? current.dials : style.dials),
      ...(imported?.tokens.density ? { density: imported.tokens.density } : {}),
      ...config.dials,
    },
    ...(fonts ? { fonts } : {}),
    // Neither belongs to a style: a switch and a lean of the greys stay with the
    // app through a change of style, until the request says otherwise.
    ...((config.switch ?? current?.switch) ? { switch: true } : {}),
    ...(neutral ? { neutral } : {}),
    read: read ?? `Reading this as: an app for the people who use it, which should feel ${style.name.toLowerCase()}.`,
    source: imported ? "import" : "user",
    ...(imported ? { imported } : {}),
  };
}

// ── What the old DESIGN.md said that tau did not write ───────────────────────

const MAX_KEPT_NOTES = 60;

/** The sections tau writes. A section under any other heading is somebody's own. */
const TAU_SECTIONS = new Set([
  "overview",
  "colors",
  "typography",
  "layout",
  "elevation & depth",
  "shapes",
  "components",
  "do's and don'ts",
  "in this app",
  // What a design read from a screenshot ends with (`fromImage.ts`). It is
  // about that design, and goes when the design does.
  "not copied",
]);

/** What a restyle used to put its kept notes under, before the file had a notes section. */
const OLD_KEPT_HEADING = "## Kept from the previous design";
const OLD_KEPT_INTRO =
  "These were added to this app's design before its style was changed. They still apply, except where the style above now says otherwise.";

/**
 * Whole sections of a file that tau never writes. The cautious answer to
 * "what was added?", for a file with no record of which lines are tau's.
 */
function foreignSections(body: string): string[] {
  const notes: string[] = [];
  let keep = false;
  for (const raw of body.split("\n")) {
    const heading = /^##\s+(.*)$/.exec(raw.trim())?.[1]?.trim();
    if (heading !== undefined) {
      const kept = raw.trim() === OLD_KEPT_HEADING;
      keep = kept || !TAU_SECTIONS.has(heading.toLowerCase());
      // Its lines are notes; its heading is not.
      if (kept) continue;
    }
    if (!keep || raw.trim() === OLD_KEPT_INTRO || isVolatileLine(raw.trim())) continue;
    if (raw.trim() || notes.length > 0) notes.push(raw.trimEnd());
  }
  while (notes.length > 0 && !notes[notes.length - 1]!.trim()) notes.pop();
  return notes;
}

/** Lines of a file that are not in its record of what tau wrote. */
function unrecordedLines(body: string, written: ReadonlySet<string>): string[] {
  const notes: string[] = [];
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line || line === OLD_KEPT_HEADING || line === OLD_KEPT_INTRO) continue;
    if (isVolatileLine(line) || written.has(lineMark(line))) continue;
    notes.push(raw.trimEnd());
  }
  return notes;
}

/**
 * What an app's `DESIGN.md` says that tau did not write — which is to say,
 * what somebody added: the agent recording that a banner is allowed a second
 * colour, the user noting that the logo stays green.
 *
 * Two places to look. The notes section is the app's by definition, and is
 * taken whole. Anything added elsewhere — a line slipped into "Typography", a
 * sentence of tau's that was reworded — is found from the file's record of the
 * lines tau wrote (`writtenLines`): a line that is not in it was added. A file
 * with no record — one the user brought, or one rewritten from scratch — gets
 * the cautious answer instead: only sections under headings tau never uses.
 */
export function keptNotes(designMd: string | null | undefined): string[] {
  if (!designMd) return [];
  const { notes, rest } = splitNotes(splitFrontMatter(designMd).body);
  const written = describeDesign(designMd)?.imported ? null : writtenLines(designMd);
  const elsewhere = written ? unrecordedLines(rest, written) : foreignSections(rest);
  // The same note in both places is one note.
  const seen = new Set<string>();
  return [...notes, ...elsewhere]
    .filter((line) => {
      const key = line.trim();
      if (!key) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_KEPT_NOTES);
}

/**
 * A new `DESIGN.md` with the notes from the old one in its notes section.
 *
 * A note that was a section heading of its own (`## Brand`) is set one level
 * down, so the notes stay one section and are found as one next time.
 */
export function withKeptNotes(designMd: string, notes: readonly string[]): string {
  if (notes.length === 0) return designMd;
  const text = notes.map((line) => line.replace(/^##(?=\s)/, "###")).join("\n");
  const opening = `${NOTES_HEADING}\n${NOTES_INTRO}\n`;
  const at = designMd.indexOf(opening);
  if (at === -1) return `${designMd.trimEnd()}\n\n${opening}\n${text}\n`;
  const after = at + opening.length;
  return `${designMd.slice(0, after)}\n${text}\n${designMd.slice(after)}`;
}

// ── What the old stylesheet held that tau did not write ──────────────────────

interface Statement {
  /** The selector or at-rule, without comments: `:root`, `@layer skin`, `@import "x"`. */
  head: string;
  /** The whole statement, leading comment included. */
  text: string;
  /** The text between its braces; null for a statement without a block. */
  body: string | null;
}

/**
 * A stylesheet's top-level statements. Tracks comments, strings and nesting,
 * so a brace inside a comment or a `content: "}"` does not end a block.
 */
export function topLevelStatements(css: string): Statement[] {
  const out: Statement[] = [];
  let start = 0;
  let depth = 0;
  let open = -1;
  let i = 0;

  const push = (end: number, bodyEnd: number | null) => {
    const text = css.slice(start, end).trim();
    if (text) {
      const bare = text.replace(/\/\*[\s\S]*?\*\//g, "").trim();
      out.push({
        head: (bodyEnd === null ? bare.replace(/;$/, "") : bare.slice(0, bare.indexOf("{"))).trim(),
        text,
        body: bodyEnd === null ? null : css.slice(open + 1, bodyEnd),
      });
    }
    start = end;
  };

  while (i < css.length) {
    const ch = css[i]!;
    if (ch === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      i = end === -1 ? css.length : end + 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      i++;
      while (i < css.length && css[i] !== ch) i += css[i] === "\\" ? 2 : 1;
      i++;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) open = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) push(i + 1, i);
    } else if (ch === ";" && depth === 0) {
      push(i + 1, null);
    }
    i++;
  }
  return out;
}

/** The blocks of a tau stylesheet whose contents tau writes afresh. */
function isTauBlock(head: string): boolean {
  return (
    head === ":root" ||
    head === ".dark" ||
    /^@theme\b/.test(head) ||
    /^@layer\s+(base|skin)$/.test(head) ||
    /^@media\s*\(\s*prefers-reduced-motion/.test(head) ||
    /^@custom-variant\s+dark\b/.test(head)
  );
}

/** `--name: value` pairs declared directly in a block. */
function customProperties(body: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const statement of topLevelStatements(body)) {
    const m = /^(--[\w-]+)\s*:\s*([\s\S]+)$/.exec(statement.head);
    if (m && statement.body === null) found.set(m[1]!, m[2]!.trim());
  }
  return found;
}

/** The package or file an `@import` names. */
function importSpec(head: string): string | null {
  return /^@import\s+(?:url\()?["']([^"']+)["']/.exec(head)?.[1] ?? null;
}

/**
 * Put back into a freshly generated stylesheet whatever the old one held that
 * tau does not generate:
 *
 *   - variables added to the light palette, the dark palette or the theme
 *     block — a `--promo` colour and the `--color-promo` that exposes it;
 *   - imports of anything but a tau style's own typefaces — a font the user
 *     asked for by name stays installed and stays imported;
 *   - whole rules outside tau's blocks.
 *
 * A variable tau does declare is not carried, whatever its old value: those
 * are the old look.
 */
export function carryOverCss(oldCss: string, newCss: string): string {
  const old = topLevelStatements(oldCss);
  const fresh = topLevelStatements(newCss);
  const block = (list: Statement[], test: (head: string) => boolean) =>
    list.find((s) => s.body !== null && test(s.head));

  let css = newCss;

  // Theme tokens differ from style to style — one sets a type scale, another
  // does not — so a token the new style leaves out is not thereby the app's.
  const tauTokens = new Set(ALL_STYLES.flatMap((style) => Object.keys(style.theme)));

  // Variables, block by block.
  const blocks: [(head: string) => boolean, string][] = [
    [(h) => h === ":root", "  "],
    [(h) => h === ".dark", "  "],
    [(h) => /^@theme\b/.test(h), "  "],
  ];
  for (const [test, indent] of blocks) {
    const before = block(old, test);
    const after = block(fresh, test);
    if (!before || !after) continue;
    const declared = customProperties(after.body!);
    const extra = [...customProperties(before.body!)].filter(
      ([name]) => !declared.has(name) && !tauTokens.has(name),
    );
    if (extra.length === 0) continue;
    const added = `\n${indent}/* Added to this app; kept through the restyle. */\n${extra
      .map(([name, value]) => `${indent}${name}: ${value};`)
      .join("\n")}\n`;
    const at = css.indexOf(after.text) + after.text.lastIndexOf("}");
    css = css.slice(0, at).trimEnd() + "\n" + added + css.slice(at);
  }

  // Imports: after the last import tau wrote, since imports must come first.
  const styleFonts = allFontPackages();
  const freshSpecs = new Set(fresh.map((s) => importSpec(s.head)).filter(Boolean));
  const extraImports = old
    .map((s) => importSpec(s.head))
    .filter((spec): spec is string => spec !== null && !freshSpecs.has(spec))
    .filter((spec) => !styleFonts.some((pkg) => spec === pkg || spec.startsWith(`${pkg}/`)));
  if (extraImports.length > 0) {
    const lines = [...new Set(extraImports)].map((spec) => `@import "${spec}";`).join("\n");
    const lastImport = [...css.matchAll(/^@import [^\n]*;$/gm)].pop();
    const at = lastImport ? lastImport.index + lastImport[0].length : 0;
    css = `${css.slice(0, at)}\n${lines}${css.slice(at)}`;
  }

  // Rules of the app's own.
  const rules = old.filter((s) => s.body !== null && !isTauBlock(s.head));
  const directives = old.filter(
    (s) => s.body === null && !importSpec(s.head) && !isTauBlock(s.head) && s.head.startsWith("@"),
  );
  const own = [...directives, ...rules];
  if (own.length > 0) {
    css = `${css.trimEnd()}\n\n/* Added to this app; kept through the restyle. */\n${own
      .map((s) => s.text.replace(/^\/\* Added to this app; kept through the restyle\. \*\/\s*/, ""))
      .join("\n\n")}\n`;
  }

  return css;
}
