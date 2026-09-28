/**
 * Global theme edits — the other half of visual edit (doc/archive/VISUAL_EDIT_PLAN.md §6
 * Phase 6).
 *
 * Everything else in this feature edits one element. This edits one *variable*
 * and every element that uses it moves: change `--primary` in `src/index.css`
 * and every `bg-primary`, `text-primary` and `ring-primary` in the app restyles
 * at once. It is the cheapest large change the product can offer, and like the
 * rest of visual edit it costs no model call.
 *
 * The templates give this a foothold that a generic CSS editor would not have.
 * `writeTheme()` emits a known shape — a `:root` block (light) and a `.dark`
 * block (dark, which is what ships active) holding flat `--name: value;`
 * declarations — and `CONTEXT.md` tells the agent to edit those palettes rather
 * than introduce parallel colour systems. So there is a specific, findable place
 * for each token.
 *
 * Same two rules as `visualEdit.ts`:
 *
 *  1. **Splice, never re-print.** We replace the bytes of one declaration's
 *     value. Running the file through a CSS printer would reformat 200 lines of
 *     theme into a diff the user's GitHub commit — and the agent's `USER_EDIT`
 *     message — could not be read.
 *  2. **Refuse rather than guess.** A token that isn't declared, a value that
 *     isn't a plain colour or length: return a reason. Never invent a
 *     declaration in a block whose shape we didn't recognise.
 */

/** Which palette a token lives in. `:root` is light, `.dark` is dark. */
export type ThemeScope = "root" | "dark";

const SELECTOR: Record<ThemeScope, string> = { root: ":root", dark: ".dark" };

export type ThemeEditFailure =
  /** Neither `:root {` nor `.dark {` is in the file — not our theme shape. */
  | "no_theme_block"
  /** The variable isn't declared in either palette. */
  | "token_not_found"
  /** The value isn't a plain hex colour / length. */
  | "invalid_value";

export type ThemeEditResult =
  | { ok: true; content: string; scope: ThemeScope }
  | { ok: false; reason: ThemeEditFailure };

/** Every token the theme panel offers, in the order it shows them. */
export const THEME_TOKENS = [
  "--primary",
  "--primary-foreground",
  "--background",
  "--foreground",
  "--card",
  "--muted",
  "--muted-foreground",
  "--accent",
  "--destructive",
  "--border",
  "--ring",
  "--radius",
] as const;

export type ThemeTokenName = (typeof THEME_TOKENS)[number];

/**
 * `#fff`, `#ffff`, `#ffffff`, `#ffffffff`.
 *
 * Hex only, on purpose. It is what every template writes, it is what a colour
 * picker produces, and it cannot contain a `;`, a `}` or a `/*` — so a written
 * value can never escape its declaration and start meaning something else. A
 * theme an agent has rewritten in `oklch()` still *reads* fine (values come back
 * verbatim, and the browser renders the swatch); we just decline to write that
 * form rather than parse a colour syntax we don't need.
 */
const HEX_COLOUR = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** `0.625rem`, `12px`, `0`. */
const LENGTH = /^(?:0|\d+(?:\.\d+)?(?:rem|px|em))$/;

/** `--radius` is a length; every other token we offer is a colour. */
export function isValidTokenValue(name: string, value: string): boolean {
  return name === "--radius" ? LENGTH.test(value) : HEX_COLOUR.test(value);
}

interface Block {
  /** Offset just after the block's `{`. */
  start: number;
  /** Offset of the block's closing `}`. */
  end: number;
}

/**
 * Find `:root { … }` / `.dark { … }`.
 *
 * Anchored on the selector *followed by a brace*, which is what keeps
 * `@custom-variant dark (&:is(.dark *));` — a line the template really does
 * write, three lines above the block we want — from matching. The closing brace
 * is found by depth counting rather than the next `}`, so a nested at-rule
 * inside the block could not truncate it.
 */
function findBlock(css: string, scope: ThemeScope): Block | null {
  const selector = SELECTOR[scope];
  const re = new RegExp(`(^|[\\s}])${escapeRegExp(selector)}\\s*\\{`, "g");
  const m = re.exec(css);
  if (!m) return null;

  const start = m.index + m[0].length;
  let depth = 1;
  for (let i = start; i < css.length; i++) {
    const ch = css[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return { start, end: i };
    }
  }
  return null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The byte range of one declaration's *value* inside a block.
 *
 * Stops at `;` or the block's end, and trims trailing whitespace so the splice
 * covers the value and nothing else — replacing `#1db954` in `--primary: #1db954;`
 * touches seven bytes and leaves the indentation, the name and the semicolon
 * exactly where they were.
 */
function declarationRange(
  css: string,
  block: Block,
  name: string,
): { start: number; end: number; value: string } | null {
  const body = css.slice(block.start, block.end);
  const re = new RegExp(`(^|[;{\\s])${escapeRegExp(name)}\\s*:`, "g");
  const m = re.exec(body);
  if (!m) return null;

  const from = block.start + m.index + m[0].length;
  let to = css.indexOf(";", from);
  if (to === -1 || to > block.end) to = block.end;

  // Skip the space after the colon, drop any before the semicolon.
  let s = from;
  while (s < to && /\s/.test(css[s] ?? "")) s++;
  let e = to;
  while (e > s && /\s/.test(css[e - 1] ?? "")) e--;

  return { start: s, end: e, value: css.slice(s, e) };
}

/**
 * Read every theme token the file declares, per palette.
 *
 * Values come back verbatim — whatever the file says, including forms we would
 * decline to write. The panel needs the truth to render a swatch, and showing
 * "unset" for a colour that is plainly there would be worse than showing a value
 * the user then can't change.
 */
export function readThemeTokens(css: string): {
  root: Record<string, string>;
  dark: Record<string, string>;
} {
  const out = { root: {}, dark: {} } as {
    root: Record<string, string>;
    dark: Record<string, string>;
  };

  for (const scope of ["root", "dark"] as const) {
    const block = findBlock(css, scope);
    if (!block) continue;
    for (const name of THEME_TOKENS) {
      const decl = declarationRange(css, block, name);
      if (decl) out[scope][name] = decl.value;
    }
  }
  return out;
}

/**
 * Set one theme variable.
 *
 * `scope` is the palette the user is looking at — the app ships `<html
 * class="dark">`, so that is usually `dark`. If the token isn't declared there
 * we fall back to the other palette and report which one we wrote, which is what
 * makes `--radius` work without a special case: the template declares it only in
 * `:root` because both themes share it.
 *
 * The two palettes are deliberately *not* written together. `:root` and `.dark`
 * hold genuinely different values (`--background` is `#ffffff` against
 * `#121212`), so a well-meant "apply to both" would collapse light mode into
 * dark the first time anyone changed a background.
 */
export function applyThemeEdit(args: {
  content: string;
  name: string;
  value: string;
  scope: ThemeScope;
}): ThemeEditResult {
  const { content, name, value, scope } = args;

  if (!isValidTokenValue(name, value)) {
    return { ok: false, reason: "invalid_value" };
  }

  const preferred = findBlock(content, scope);
  const other = findBlock(content, scope === "dark" ? "root" : "dark");
  if (!preferred && !other) return { ok: false, reason: "no_theme_block" };

  const candidates: Array<{ scope: ThemeScope; block: Block }> = [];
  if (preferred) candidates.push({ scope, block: preferred });
  if (other) {
    candidates.push({ scope: scope === "dark" ? "root" : "dark", block: other });
  }

  for (const candidate of candidates) {
    const decl = declarationRange(content, candidate.block, name);
    if (!decl) continue;
    return {
      ok: true,
      scope: candidate.scope,
      content:
        decl.value === value
          ? content
          : content.slice(0, decl.start) + value + content.slice(decl.end),
    };
  }

  return { ok: false, reason: "token_not_found" };
}
