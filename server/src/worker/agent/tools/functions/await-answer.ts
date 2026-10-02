import { publish } from "@/worker/lib/publish";
import { bus } from "@/lib/bus";
import { prisma } from "@/lib/prisma";
import { ToolCallStatus } from "@/generated/prisma/enums";

export const ANSWER_TIMEOUT_MS = 600_000;

export type AwaitedAnswer =
  | { answer: string }
  | { answer: null; cancelled: true }
  | { answer: null; timedOut: true };

/**
 * Block until the user answers the question published as `toolCallId`, the
 * job is cancelled, or ten minutes pass.
 *
 * Shared by `ask_user` and `request_secret`: both pause the run on a RUNNING
 * tool-call row that the API claims (status → SUCCESS, `output.answer`) and then
 * signals over the bus. The row is the durable waiting state, so a refreshed
 * browser can recover the question even when the in-memory event buffer is gone.
 *
 * The caller must have called `bus.registerQuestion` and published the
 * question; this clears it on the way out.
 */
export async function awaitAnswer(
  jobId: string,
  toolCallId: string,
): Promise<AwaitedAnswer> {
  try {
    // The bus is the fast path. Also check the persisted answer every few
    // seconds: a successful DB claim followed by a failed in-process handoff
    // must not leave the user waiting until the ten-minute timeout.
    const deadline = Date.now() + ANSWER_TIMEOUT_MS;
    let answer: string | null = null;
    while (Date.now() < deadline) {
      answer = await bus.waitForUserResponse(jobId, Math.min(5000, deadline - Date.now()));
      if (answer !== null || bus.isCancelled(jobId)) break;
      const persisted = await prisma.toolCall.findUnique({
        where: { id: toolCallId },
        select: { status: true, output: true },
      });
      const saved = persisted?.output as { answer?: unknown } | null;
      if (persisted?.status === ToolCallStatus.SUCCESS && typeof saved?.answer === "string") {
        answer = saved.answer;
        break;
      }
    }
    if (answer !== null) return { answer };
    if (bus.isCancelled(jobId)) return { answer: null, cancelled: true };

    // Race timeout against an answer that the API has already committed.
    const expired = await prisma.toolCall.updateMany({
      where: { id: toolCallId, status: ToolCallStatus.RUNNING },
      data: { status: ToolCallStatus.FAILED, error: "Question timed out" },
    });
    if (expired.count > 0) {
      await publish(jobId, { type: "ask_user_expired", questionId: toolCallId });
      return { answer: null, timedOut: true };
    }
    const accepted = await prisma.toolCall.findUnique({
      where: { id: toolCallId },
      select: { output: true },
    });
    const saved = accepted?.output as { answer?: unknown } | null;
    if (typeof saved?.answer === "string") return { answer: saved.answer };
    return { answer: null, timedOut: true };
  } finally {
    bus.clearQuestion(jobId, toolCallId);
  }
}
