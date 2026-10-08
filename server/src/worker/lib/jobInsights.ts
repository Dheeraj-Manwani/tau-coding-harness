/**
 * What a run did that the `Job` columns do not say, kept for the admin job page.
 *
 * Cache hits, summaries, the look that was chosen and each design review used to
 * exist only as log lines. They are small, so they live on the job as one JSON
 * value, merged into as the run goes. Nothing here calls a model.
 *
 * Never throws: a missing note must not fail the run it describes.
 */
import { prisma } from "@/lib/prisma";
import { log } from "./log";

export interface DesignReviewNote {
  verdict: string;
  routes: string[];
  screens: number;
  steps: number;
  reference: boolean;
  captureMs: number;
  modelMs: number;
}

export interface JobInsights {
  cache?: { turns: number; inputTokens: number; cachedTokens: number; cachedPct: number };
  summaries?: number;
  design?: { style: string; accent: string; mode: string; source: string; read: string };
  reviews?: DesignReviewNote[];
  /**
   * The run said it was finished over an app that did not work, and was sent
   * back to fix it. `sentBack` is what was wrong: `crashed`, `blank` or
   * `build_error` (lib/previewReport.ts).
   */
  render?: { sentBack: string };
  /** The run ended with the dev server still refusing to compile the app. */
  endedNotCompiling?: boolean;
}

/** Set some keys of a job's insights, leaving the others as they are. */
export async function noteInsights(jobId: string, patch: Partial<JobInsights>): Promise<void> {
  try {
    await prisma.$executeRaw`UPDATE "Job" SET "insights" = COALESCE("insights", '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb WHERE "id" = ${jobId}`;
  } catch (err) {
    log.warn("job.insights.failed", { jobId, error: String(err).slice(0, 200) });
  }
}

/** Add one design review to a job's list of them. */
export async function noteReview(jobId: string, review: DesignReviewNote): Promise<void> {
  try {
    await prisma.$executeRaw`UPDATE "Job" SET "insights" = jsonb_set(COALESCE("insights", '{}'::jsonb), '{reviews}', COALESCE("insights"->'reviews', '[]'::jsonb) || ${JSON.stringify(review)}::jsonb) WHERE "id" = ${jobId}`;
  } catch (err) {
    log.warn("job.insights.failed", { jobId, error: String(err).slice(0, 200) });
  }
}
