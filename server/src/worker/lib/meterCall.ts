/**
 * Charging for a model call the harness makes on a run's behalf.
 *
 * The agent loop and the sub-agent loop meter their own turns. A few other
 * calls belong to a run without being a turn of either — the design director
 * choosing a look, the design reviewer looking at screenshots — and they cost
 * the same money, so they are charged the same way: a `TokenUsage` row for the
 * record, a debit against the run's hold, and a balance tick for the UI.
 *
 * Never throws. A call that has already happened cannot be un-made, and failing
 * the run over its bookkeeping would cost the user more than the call did.
 */
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { meter } from "@/lib/credits";
import { toCredits } from "@/lib/pricing";
import { publish } from "./publish";
import { captureException } from "./log";

export interface CallOwner {
  userId: string;
  projectId: string;
  jobId: string;
  /** The run's shared counter; gives this call a sequence no other debit has. */
  indexer: () => number;
}

export interface CallUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export async function meterModelCall(
  owner: CallOwner,
  usage: CallUsage,
  what: string,
): Promise<void> {
  try {
    await prisma.tokenUsage.create({
      data: {
        userId: owner.userId,
        projectId: owner.projectId,
        jobId: owner.jobId,
        model: usage.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      },
    });
    // Negative sequence: the namespace sub-agent turns use, which cannot
    // collide with the main loop's message sequences (see sub-agent-executor).
    const result = await meter(
      owner.userId,
      owner.jobId,
      usage.model,
      usage.inputTokens,
      usage.outputTokens,
      -owner.indexer(),
      { enforce: env.CREDITS_ENFORCE },
    );
    if (env.CREDITS_ENFORCE) {
      await publish(owner.jobId, {
        type: "credits_update",
        available: toCredits(result.available),
        availableMicro: result.available.toString(),
      });
    }
  } catch (err) {
    captureException(err, { jobId: owner.jobId, detail: `${what} meter failed` });
  }
}
