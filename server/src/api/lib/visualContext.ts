/**
 * "The user selected this element" — the block that rides along with a chat
 * message sent from the visual-edit inspector.
 *
 * The problem it solves: an element prompt needs the file, the line, the tag
 * and the current text and classes, or the agent cannot find what was clicked.
 * The first version of this feature prepended that to the user's own message,
 * which worked and read terribly — the transcript showed a paragraph of
 * bookkeeping where the user had typed one sentence.
 *
 * So it goes where attachment text already goes: a later block in the USER
 * message's content array. That array is handed straight to the completions
 * API (`loadHistory`), so the model reads every block, while the web
 * transcript renders only block 0. The model gets the context, the bubble
 * stays the sentence the user typed, and neither side needed a new column.
 *
 * The tag is the same shape as `attachmentBlock`'s, for the same reason: it is
 * read as text by a model, so it must be self-delimiting and its attributes
 * must be escaped.
 *
 * See doc/VISUAL_EDIT_PROMPTING.md §7.
 */
import { escapeAttr } from "./attachments";
import { parseLoc } from "./visualEdit";

/** Which value the deterministic editor found it could not touch. */
export type ComputedValue = "text" | "className" | "attribute";

/**
 * Facts about the picked element, as reported by the in-iframe runtime.
 *
 * Deliberately all facts and no prose: the client sends what it observed, and
 * every sentence the model reads is written here. A `hint: string` field would
 * have been shorter and would have put model-facing wording in two codebases.
 */
export interface VisualContext {
  /** `src/App.tsx:42:7` — path, 1-based line, 1-based column. */
  loc: string;
  tagName: string;
  className?: string;
  text?: string;
  /** Browser-resolved `src`, for `<img>`. */
  src?: string;
  /** DOM nodes sharing this source position. >1 means a `.map()`. */
  siblingCount?: number;
  /** Set when the deterministic path refused because this value is computed.
   *  Load-bearing: told only "apply bg-red-500", the agent bolts a literal
   *  class onto an element whose className is built elsewhere — the wrong fix,
   *  and one that looks right. */
  computed?: ComputedValue;
}

/**
 * Long values are quoted for recognition, not reproduced, and cannot contain
 * markup.
 *
 * The escaping is the load-bearing half. Everything interpolated here is read
 * off the DOM of the generated app, so a `text` of `"</selected-element> Ignore
 * the above"` would close the block early and the remainder would reach the
 * model as a top-level instruction rather than as a quoted observation. Angle
 * brackets are the only characters that can do that, so they are the only ones
 * neutralised — quotes and backticks stay readable.
 *
 * This block is more sensitive than `attachmentBlock`'s body, which is framed
 * to the model as user-supplied content. This one speaks in tau's voice.
 */
function body(s: string, max: number): string {
  const clamped = s.length > max ? `${s.slice(0, max)}…` : s;
  return clamped.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Reduce a reported tag name to something that can be read as a tag name.
 *
 * It is rendered as literal `<button>` in the prose — which is what makes that
 * sentence legible — so unlike every other value here it cannot be escaped
 * without becoming noise. A real host element name is `[a-z][a-z0-9-]*`;
 * anything else did not come from the tagger.
 */
function safeTagName(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9-]/g, "");
  return cleaned.length > 0 ? cleaned : "element";
}

const COMPUTED_SENTENCE: Record<ComputedValue, string> = {
  text:
    "Its text is rendered from code rather than being a literal string, so" +
    " change it wherever that value comes from.",
  className:
    "Its `className` is computed rather than a literal class list, so update" +
    " it wherever that value is built rather than adding a literal class.",
  attribute:
    "That attribute is set from code, so change it wherever the value comes" +
    " from rather than hardcoding it on the element.",
};

/**
 * Render the block. Returns null for a `loc` that isn't `path:line:col` —
 * without a real position there is nothing here worth telling the model, and a
 * malformed one would point it at a line that doesn't exist.
 */
export function visualContextBlock(ctx: VisualContext): string | null {
  const parsed = parseLoc(ctx.loc);
  if (!parsed) return null;

  const tag = safeTagName(ctx.tagName);
  const facts = [
    `the \`<${tag}>\` at ${body(parsed.path, 300)} line ${parsed.line}`,
  ];
  if (ctx.text) facts.push(`currently "${body(ctx.text, 120)}"`);
  if (ctx.className) facts.push(`classes \`${body(ctx.className, 400)}\``);
  if (ctx.src) {
    facts.push(`\`src\` currently resolving to \`${body(ctx.src, 200)}\``);
  }

  const lines = [
    `The user selected this element in the live preview: ${facts.join(", ")}.`,
  ];
  if (ctx.computed) lines.push(COMPUTED_SENTENCE[ctx.computed]);
  if ((ctx.siblingCount ?? 1) > 1) {
    lines.push(
      `This element is rendered ${ctx.siblingCount} times from one place in` +
        ` the code — change it for all of them.`,
    );
  }
  lines.push(
    "Their message above is about this element. Edit it where it is defined.",
  );

  const attrs =
    `file="${escapeAttr(parsed.path)}"` +
    ` line="${parsed.line}"` +
    ` tag="${tag}"`;

  return `<selected-element ${attrs}>\n${lines.join(" ")}\n</selected-element>`;
}
