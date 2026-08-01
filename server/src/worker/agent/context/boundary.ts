import { estimateMessageTokens } from "./tokens";
import type { Entry } from "./types";

/**
 * Choose where the retained verbatim tail begins. Walks back from the end
 * accumulating tokens until `keepTailTokens`, then snaps the boundary forward
 * past any leading `tool` messages so the tail never starts with a tool result
 * orphaned from its assistant tool_call (the completions API rejects that).
 * Index 0 (system) is never included in a tail boundary.
 */
export function pickBoundary(entries: Entry[], keepTailTokens: number): number {
  let acc = 0;
  let b = entries.length;
  for (let i = entries.length - 1; i >= 1; i--) {
    acc += estimateMessageTokens(entries[i]!.param);
    if (acc >= keepTailTokens) {
      b = i;
      break;
    }
  }
  while (b < entries.length && entries[b]!.param.role === "tool") b++;
  return b;
}
