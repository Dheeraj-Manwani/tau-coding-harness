/**
 * Restating a refused deterministic edit as a request the user can send.
 *
 * When an element's text, classes or `src` are computed rather than literal,
 * the deterministic path can't touch it (see `VisualEditFailure` in
 * `server/src/api/lib/visualEdit.ts`). The bad version of that is an error
 * toast and a dead end. The good version is this: the intent is already known
 * exactly, so it goes into the inspector's prompt box as one editable
 * sentence, and the user hits Enter.
 *
 * Note what is *not* here. The prose describing the element: file, line, tag,
 * current text and classes: is written by the API
 * (`server/src/api/lib/visualContext.ts`) and travels beside the message
 * rather than inside it. That is what keeps the chat bubble to the sentence
 * the user actually typed, and it means model-facing wording lives in one
 * codebase rather than two.
 *
 * See doc/VISUAL_EDIT_PROMPTING.md §7.
 */
import type { VisualEditOpInput } from "@/src/stores/useProjectStore";

/**
 * Which value the server declined to rewrite, in the vocabulary the API's
 * `visualContext` expects. Load-bearing: told only "apply `bg-red-500`", the
 * agent bolts a literal class onto an element whose `className` is built
 * elsewhere: the wrong fix, and one that looks right.
 */
export type ComputedValue = "text" | "className" | "attribute";

export function computedValueFor(op: VisualEditOpInput): ComputedValue {
  if (op.kind === "text") return "text";
  if (op.kind === "classes") return "className";
  return "attribute";
}

/**
 * The request half of a refusal, phrased to stand on its own in the prompt box.
 *
 * Deliberately states the *intent* ("change the text to X") rather than the
 * mechanism, because the reason it was refused is that the mechanism doesn't
 * apply: the text comes from a variable, the classes from `cn(...)`.
 */
export function describeRefusedEdit(op: VisualEditOpInput): string {
  if (op.kind === "text") {
    return `Change this element's text to "${op.value}".`;
  }

  if (op.kind === "attr") {
    return `Set this element's \`${op.name}\` to "${op.value}".`;
  }

  const bits: string[] = [];
  if (op.add?.length) {
    bits.push(`apply ${op.add.map((c) => `\`${c}\``).join(", ")}`);
  }
  if (op.remove?.length) {
    bits.push(`remove ${op.remove.map((c) => `\`${c}\``).join(", ")}`);
  }
  if (!bits.length) return "Adjust this element's styling.";
  return `${bits.join(" and ")} on this element.`.replace(/^./, (c) =>
    c.toUpperCase(),
  );
}
