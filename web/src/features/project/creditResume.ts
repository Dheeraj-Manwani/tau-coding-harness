import type { Message } from "@/src/stores/useProjectStore";

const OUT_OF_CREDITS_NOTICE = "⚠️ Out of credits";

export const CREDIT_RESUME_PROMPT =
  "Continue the previous task from exactly where you left off. Do not repeat completed work.";

export function wasInterruptedForCredits(
  messages: readonly Pick<Message, "role" | "content">[],
): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role === "divider") continue;
    return (
      message.role === "ai" &&
      message.content.trimStart().startsWith(OUT_OF_CREDITS_NOTICE)
    );
  }

  return false;
}

/**
 * Offer recovery only while the out-of-credits result is still the end of the
 * conversation. Once the user sends anything else, that new turn owns what
 * should happen next and the shortcut must disappear.
 */
export function shouldOfferCreditResume(
  messages: readonly Pick<Message, "role" | "content">[],
  availableCredits: number | undefined,
): boolean {
  if (availableCredits === undefined || availableCredits <= 0) return false;
  return wasInterruptedForCredits(messages);
}
