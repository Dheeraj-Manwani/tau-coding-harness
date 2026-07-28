import { prisma } from "./prisma";
import { costMicro } from "./pricing";
import { captureException } from "./log";

/**
 * Fold this job's per-turn `TokenUsage` rows into totals on the `Job` row.
 *
 * Everything here is derivable by joining `TokenUsage`, but the admin job list
 * and the metrics windows read these numbers per-row and across every job in a
 * time range — denormalising turns those into one indexed scan instead of a
 * join over every turn of every job.
 *
 * Grouped by model rather than summed flat: a MAX run can span two models (the
 * main loop on Kimi, summarisation on Deepseek) which are priced differently, so
 * a single blended rate would quietly misreport cost. Best-effort — a job's
 * accounting is already correct in `TokenUsage` and `CreditHold`; this is the
 * reporting copy, and it must never fail a run that otherwise succeeded.
 */
export async function finalizeJobRollups(jobId: string): Promise<void> {
  try {
    const grouped = await prisma.tokenUsage.groupBy({
      by: ["model"],
      where: { jobId },
      _sum: { inputTokens: true, outputTokens: true },
    });
    if (grouped.length === 0) return;

    let inputTokens = 0;
    let outputTokens = 0;
    let cost = 0n;
    // The model that did the most work — what an operator means by "which model
    // ran this job", even when summarisation used a cheaper one.
    let dominant = { model: grouped[0]!.model, tokens: -1 };

    for (const row of grouped) {
      const input = row._sum.inputTokens ?? 0;
      const output = row._sum.outputTokens ?? 0;
      inputTokens += input;
      outputTokens += output;
      cost += costMicro(row.model, input, output);
      if (input + output > dominant.tokens) {
        dominant = { model: row.model, tokens: input + output };
      }
    }

    await prisma.job.update({
      where: { id: jobId },
      data: { inputTokens, outputTokens, costMicro: cost, model: dominant.model },
    });
  } catch (err) {
    captureException(err, { jobId, detail: "job rollup failed" });
  }
}
