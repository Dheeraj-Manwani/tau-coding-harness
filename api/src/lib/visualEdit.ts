/**
 * Deterministic source edits driven by a click in the preview.
 *
 * The tagger (`worker-service/src/templates/visual-edit/tagger.ts`) stamps every
 * host element with `data-tau-loc="src/App.tsx:42:7"`. This module turns one of
 * those positions plus a requested change into new file bytes — with no model
 * call, which is the entire point of the feature: "make this heading say X"
 * should cost nothing and take a second, not a full agent turn.
 *
 * Two rules shape everything here:
 *
 *  1. **Splice, never re-print.** We locate the node, take its byte range, and
 *     patch the string. Emitting the AST through TypeScript's printer would
 *     reformat the whole file, and that diff goes on to the user's GitHub commit
 *     *and* to the agent as a `USER_EDIT` message. A visual edit must produce a
 *     one-line diff.
 *  2. **Refuse rather than guess.** Anything dynamic — an expression child, a
 *     nested element, a mapped list — returns a `reason` instead of an edit. The
 *     caller turns that into a chat fallback (plan §6 Phase 4). Corrupting a
 *     file to avoid saying "no" is the worst outcome available.
 *
 * See doc/VISUAL_EDIT_PLAN.md §5.3.
 */
import ts from "typescript";
import { twMerge } from "tailwind-merge";

/** The change requested. */
export type VisualEditOp =
  | { kind: "text"; value: string }
  | { kind: "classes"; add?: string[]; remove?: string[] };

/** Why an edit could not be applied deterministically. */
export type VisualEditFailure =
  /** `loc` was not `path:line:col`, or pointed outside the file. */
  | "bad_loc"
  /** No JSX element starts at that position — the file moved under us. */
  | "not_found"
  /** An element is there, but not the one the user clicked. */
  | "tag_mismatch"
  /** Content isn't a single static text node (expression, children, empty). */
  | "dynamic_children"
  /** Refusing to blank out the element — it would become uneditable. */
  | "empty_value"
  /** Newlines would wreck the formatting of a single-line element. */
  | "multiline_value"
  /** `className` is computed — `cn(...)`, a template literal, a conditional. */
  | "dynamic_classname"
  /** A class name contained characters that can't be spliced into a string. */
  | "invalid_class";

export type VisualEditResult =
  | {
      ok: true;
      content: string;
      /**
       * The element's class list after merging, for `classes` ops.
       *
       * Returned so the client doesn't have to re-implement tailwind-merge to
       * know what it ended up with: adding `p-6` to `px-4 py-2` drops both, and
       * a client guessing at that would show a class list the file disagrees
       * with until the next reselect.
       */
      className?: string;
    }
  | { ok: false; reason: VisualEditFailure };

export interface ParsedLoc {
  path: string;
  /** 1-based, matching editors and the tagger's wire format. */
  line: number;
  /** 1-based. */
  column: number;
}

/**
 * `src/App.tsx:42:7` → `{ path, line, column }`.
 *
 * The path may itself contain colons on exotic filesystems, so anchor on the
 * two trailing numeric segments rather than splitting on every ":".
 */
export function parseLoc(loc: string): ParsedLoc | null {
  const m = /^(.+):(\d+):(\d+)$/.exec(loc);
  if (!m) return null;
  const [, path, rawLine, rawCol] = m;
  const line = Number(rawLine);
  const column = Number(rawCol);
  if (!path || !Number.isInteger(line) || !Number.isInteger(column)) return null;
  if (line < 1 || column < 1) return null;
  return { path, line, column };
}

/**
 * Escape a plain string so it is safe as JSX text.
 *
 * `{` and `}` open expressions and `<` opens an element, so an unescaped value
 * would change the *structure* of the file rather than its content — the one
 * way this function could produce a file that no longer parses. With these five
 * replacements the result is inert text by construction, which is why there is
 * no re-parse check afterwards. `&` must go first or it would double-escape the
 * entities the later rules introduce.
 */
export function escapeJsxText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\{/g, "&#123;")
    .replace(/\}/g, "&#125;");
}

/**
 * Characters a class name may contain.
 *
 * The merged list is spliced into a double-quoted JSX string, so anything that
 * could close that string (or open an expression) has to be rejected rather
 * than escaped — a quote here would rewrite the element's attributes. Covers
 * ordinary utilities, variants (`md:`, `hover:`) and arbitrary values
 * (`w-[32px]`, `bg-[#fff]`), but deliberately not arbitrary values that embed
 * quotes, e.g. `bg-[url('x.png')]`.
 */
const CLASS_TOKEN = /^[A-Za-z0-9_:\-[\]/.%()#!@,+*<>=&|~^]+$/;

/**
 * Fold `add`/`remove` into an existing class string.
 *
 * `tailwind-merge` does the hard part — knowing that `bg-red-500` supersedes
 * `bg-blue-500` while leaving `spike-card` alone — but it also reorders what
 * survives. Reordering an untouched attribute would turn a one-word style tweak
 * into a diff across the whole line, in a commit and in the `USER_EDIT` the
 * agent reads. So we use twMerge purely as an oracle for *which* classes
 * survive, then re-emit them in the original order with additions appended.
 */
export function mergeClasses(
  existing: string,
  add: string[] = [],
  remove: string[] = [],
): string {
  const current = existing.split(/\s+/).filter(Boolean);
  const dropped = new Set(remove);
  const kept = current.filter((c) => !dropped.has(c));

  const survivors = new Set(
    twMerge([...kept, ...add].join(" ")).split(/\s+/).filter(Boolean),
  );

  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of kept) {
    if (survivors.has(c) && !seen.has(c)) {
      out.push(c);
      seen.add(c);
    }
  }
  for (const c of add) {
    if (survivors.has(c) && !seen.has(c)) {
      out.push(c);
      seen.add(c);
    }
  }
  return out.join(" ");
}

/** The element's `className` attribute, if it has one. */
function classNameAttribute(
  el: ts.JsxElement | ts.JsxSelfClosingElement,
  sf: ts.SourceFile,
): ts.JsxAttribute | undefined {
  const opening = ts.isJsxElement(el) ? el.openingElement : el;
  for (const prop of opening.attributes.properties) {
    if (ts.isJsxAttribute(prop) && prop.name.getText(sf) === "className") {
      return prop;
    }
  }
  return undefined;
}

/**
 * The string literal holding the class list, and the byte range of its
 * *contents* (inside the quotes).
 *
 * Handles `className="a b"` and `className={"a b"}`. Anything else — `cn(...)`,
 * a template literal with substitutions, a ternary — is computed at runtime and
 * has no single literal to edit, so the caller must fall back to the agent.
 */
function classLiteralRange(
  attr: ts.JsxAttribute,
): { start: number; end: number; text: string } | null {
  const init = attr.initializer;
  if (!init) return null;

  let literal: ts.Node | null = null;
  if (ts.isStringLiteral(init)) {
    literal = init;
  } else if (ts.isJsxExpression(init) && init.expression) {
    const inner = init.expression;
    if (ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner)) {
      literal = inner;
    }
  }
  if (!literal) return null;

  // getStart/getEnd span the quotes; the contents are one character inside.
  return {
    start: literal.getStart() + 1,
    end: literal.getEnd() - 1,
    text: (literal as ts.StringLiteral).text,
  };
}

/** Byte offset of a 1-based line/column, or null if it isn't in the file. */
function offsetOf(sf: ts.SourceFile, line: number, column: number): number | null {
  const starts = sf.getLineStarts();
  const lineStart = starts[line - 1];
  if (lineStart === undefined) return null;
  const offset = lineStart + (column - 1);
  // Must still be on the same line: a bogus column shouldn't silently address
  // some node further down the file.
  const nextLineStart = starts[line] ?? sf.text.length + 1;
  if (offset >= nextLineStart || offset > sf.text.length) return null;
  return offset;
}

/** The JSX element whose opening tag starts exactly at `offset`. */
function elementAt(
  sf: ts.SourceFile,
  offset: number,
): ts.JsxElement | ts.JsxSelfClosingElement | null {
  let found: ts.JsxElement | ts.JsxSelfClosingElement | null = null;

  const visit = (node: ts.Node): void => {
    if (found) return;
    // Nothing inside a node that ends before the offset can match; skip the
    // whole subtree rather than walking every token of a large file.
    if (node.end < offset) return;

    if (ts.isJsxElement(node) && node.openingElement.getStart(sf) === offset) {
      found = node;
      return;
    }
    if (ts.isJsxSelfClosingElement(node) && node.getStart(sf) === offset) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
  return found;
}

function tagNameOf(
  el: ts.JsxElement | ts.JsxSelfClosingElement,
  sf: ts.SourceFile,
): string {
  const name = ts.isJsxElement(el) ? el.openingElement.tagName : el.tagName;
  return name.getText(sf);
}

/**
 * Apply one visual edit to a file's source, returning the new bytes.
 *
 * Pure: no I/O, no network, no model. Every branch that isn't a clean success
 * returns a `reason` the caller can surface or fall back on.
 */
export function applyVisualEdit(args: {
  content: string;
  fileName: string;
  line: number;
  column: number;
  /** Tag the client believes it clicked, e.g. `button`. Guards against the
   *  file having changed since the element was selected. */
  expectTag: string;
  op: VisualEditOp;
}): VisualEditResult {
  const { content, fileName, line, column, expectTag, op } = args;

  const sf = ts.createSourceFile(
    fileName,
    content,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX,
  );

  const offset = offsetOf(sf, line, column);
  if (offset === null) return { ok: false, reason: "bad_loc" };

  const el = elementAt(sf, offset);
  if (!el) return { ok: false, reason: "not_found" };
  if (tagNameOf(el, sf) !== expectTag) return { ok: false, reason: "tag_mismatch" };

  return op.kind === "text"
    ? applyTextOp(content, sf, el, op.value)
    : applyClassesOp(content, sf, el, op.add ?? [], op.remove ?? []);
}

/** Replace an element's single static text child. */
function applyTextOp(
  content: string,
  sf: ts.SourceFile,
  el: ts.JsxElement | ts.JsxSelfClosingElement,
  value: string,
): VisualEditResult {
  if (!value.trim()) return { ok: false, reason: "empty_value" };
  if (/[\r\n]/.test(value)) return { ok: false, reason: "multiline_value" };

  // A self-closing element has nowhere to put text.
  if (!ts.isJsxElement(el)) return { ok: false, reason: "dynamic_children" };

  // Exactly one child, and it must be static text. Two children means markup or
  // an expression is interleaved and the "one obvious place for the text" this
  // edit depends on doesn't exist.
  const children = el.children;
  if (children.length !== 1) return { ok: false, reason: "dynamic_children" };
  const child = children[0];
  if (!child || !ts.isJsxText(child)) return { ok: false, reason: "dynamic_children" };

  // Use `pos`/`end`, not `getStart()`: for JsxText the surrounding whitespace is
  // the node's own content, and getStart() would skip it as trivia — losing the
  // indentation we are about to preserve.
  const raw = content.slice(child.pos, child.end);
  if (!raw.trim()) return { ok: false, reason: "dynamic_children" };

  // Keep the element's existing layout exactly: only the words change.
  //   "\n        Click me\n      "  →  "\n        Sign up\n      "
  const leading = /^\s*/.exec(raw)?.[0] ?? "";
  const body = raw.slice(leading.length);
  const trailing = /\s*$/.exec(body)?.[0] ?? "";

  const replacement = leading + escapeJsxText(value) + trailing;
  if (replacement === raw) return { ok: true, content };

  return {
    ok: true,
    content:
      content.slice(0, child.pos) + replacement + content.slice(child.end),
  };
}

/**
 * Add and remove Tailwind classes on an element.
 *
 * Three shapes to handle: an existing string literal (rewrite its contents), no
 * `className` at all (insert one after the tag name), and a computed value
 * (refuse — see `dynamic_classname`).
 */
function applyClassesOp(
  content: string,
  sf: ts.SourceFile,
  el: ts.JsxElement | ts.JsxSelfClosingElement,
  add: string[],
  remove: string[],
): VisualEditResult {
  for (const c of [...add, ...remove]) {
    if (!CLASS_TOKEN.test(c)) return { ok: false, reason: "invalid_class" };
  }
  const attr = classNameAttribute(el, sf);
  const existing = attr ? classLiteralRange(attr) : null;

  // An element whose className is computed can't be edited at all — say so
  // before checking whether the op is a no-op, so the UI gets the real reason.
  if (attr && !existing) return { ok: false, reason: "dynamic_classname" };

  const before = existing?.text ?? "";
  const merged = mergeClasses(before, add, remove);
  if (merged === before) return { ok: true, content, className: merged };

  // No className yet: synthesise one immediately after the tag name, which is
  // correct for `<div>`, `<div id="x">` and `<div />` alike.
  if (!attr || !existing) {
    const opening = ts.isJsxElement(el) ? el.openingElement : el;
    const at = opening.tagName.getEnd();
    return {
      ok: true,
      className: merged,
      content: `${content.slice(0, at)} className="${merged}"${content.slice(at)}`,
    };
  }

  // Removing the last class would leave `className=""`, which is noise. Drop
  // the whole attribute instead, including the space in front of it.
  if (!merged) {
    const from = attr.getStart(sf);
    const to = attr.getEnd();
    const spaceBefore = /\s/.test(content[from - 1] ?? "") ? 1 : 0;
    return {
      ok: true,
      className: "",
      content: content.slice(0, from - spaceBefore) + content.slice(to),
    };
  }

  return {
    ok: true,
    className: merged,
    content:
      content.slice(0, existing.start) + merged + content.slice(existing.end),
  };
}
