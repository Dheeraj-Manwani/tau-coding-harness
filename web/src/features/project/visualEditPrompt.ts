/**
 * Turning a refused visual edit into a well-aimed chat message.
 *
 * When an element's text or styles are computed rather than literal, the
 * deterministic path can't touch it (see `VisualEditFailure` in
 * `api/src/lib/visualEdit.ts`). The bad version of that is an error toast and a
 * dead end. The good version is this: we already know the file, the line, the
 * tag and exactly what the user was trying to do, so we can write the prompt
 * for them — far more precise than what they'd have typed unaided.
 *
 * See doc/VISUAL_EDIT_PLAN.md §6 Phase 4.
 */
import {
  locToLine,
  locToPath,
  type VisualEditOpInput,
  type VisualSelection,
} from "@/src/stores/useProjectStore";

/** A short, human way to point at the element among its siblings. */
function identify(selection: VisualSelection): string {
  const parts: string[] = [`the \`<${selection.tagName}>\` element`];
  if (selection.text) {
    // Quote the visible text — it's how the user thinks about the element and
    // the fastest way for the agent to find the right one.
    const snippet =
      selection.text.length > 60
        ? `${selection.text.slice(0, 60)}…`
        : selection.text;
    parts.push(`(currently "${snippet}")`);
  } else if (selection.className) {
    parts.push(`(classes: \`${selection.className}\`)`);
  }
  return parts.join(" ");
}

/**
 * Write the chat message for an edit tau couldn't apply itself.
 *
 * Deliberately states the *intent* ("change the text to X") rather than the
 * mechanism, because the reason it was refused is that the mechanism doesn't
 * apply — the text comes from a variable, the classes from `cn(...)`. The agent
 * needs to work out where the value really comes from.
 */
export function buildFallbackPrompt(
  selection: VisualSelection,
  op: VisualEditOpInput,
): string {
  const path = locToPath(selection.loc);
  const line = locToLine(selection.loc);
  const where = `In \`${path}\` (around line ${line}), ${identify(selection)}`;

  const shared =
    selection.siblingCount > 1
      ? ` Note this element is rendered ${selection.siblingCount} times from one place in the code — change it for all of them.`
      : "";

  if (op.kind === "text") {
    return `${where}: change its text to "${op.value}".${shared}`;
  }

  const add = op.add ?? [];
  const remove = op.remove ?? [];
  const bits: string[] = [];
  if (add.length) bits.push(`apply ${add.map((c) => `\`${c}\``).join(", ")}`);
  if (remove.length) {
    bits.push(`remove ${remove.map((c) => `\`${c}\``).join(", ")}`);
  }
  const change = bits.length ? bits.join(" and ") : "adjust its styling";

  return (
    `${where}: ${change}.` +
    ` Its \`className\` is computed, so update it wherever that value is built` +
    ` rather than adding a literal class.${shared}`
  );
}
