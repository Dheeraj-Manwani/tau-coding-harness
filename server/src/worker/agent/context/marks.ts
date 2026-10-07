/**
 * How tau recognises a message it wrote into a history itself, and how it
 * reads a message as plain text. A leaf module: the summarizer has to skip
 * restored state, and the code that restores state runs after the summarizer,
 * so neither can own these without importing the other.
 */
import type { MessageParam } from "./types";

/** First line of the state restored after a summary (`restore.ts`). */
export const RESTORED_HEADER = "[tau: restored after a summary]";

/** Whether a message is a restored-state block. */
export function isRestoredState(param: MessageParam): boolean {
  return (
    param.role === "user" &&
    typeof param.content === "string" &&
    param.content.startsWith(RESTORED_HEADER)
  );
}

/** The text of a message's content, whatever shape it has; images and the like are skipped. */
export function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
        ? (part as { text: string }).text
        : "",
    )
    .filter(Boolean)
    .join("\n");
}
