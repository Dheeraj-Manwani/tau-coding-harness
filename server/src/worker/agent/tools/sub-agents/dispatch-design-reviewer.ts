import type Sandbox from "e2b";
import { prisma } from "@/lib/prisma";
import { ToolCallStatus } from "@/generated/prisma/enums";
import { log } from "@/worker/lib/log";
import { withDeadline } from "@/worker/lib/sandbox";
import { meterModelCall } from "@/worker/lib/meterCall";
import { readOrNull } from "@/worker/lib/appStack";
import { designReferenceKey, getObjectBytes } from "@/lib/s3";
import { normalizeDesignConfig } from "@/worker/design/config";
import { DESIGN_PATH, designProse } from "@/worker/design/designMd";
import {
  MAX_REVIEW_PATHS,
  designReviewAvailable,
  nextStep,
  planReview,
  refusal,
  reviewDesign,
  reviewSteps,
  type PastReview,
} from "@/worker/design/review";
import { PREVIEW_PORT } from "../../config";

const TOOL_NAME = "dispatch_design_reviewer";

/**
 * The reviews this run has already had, read back from its own tool calls.
 *
 * Kept nowhere else: the stored result of each call is the record, so the
 * limits hold across a process restart and need no state passed through the
 * loop. A call that failed, or was refused, reviewed nothing and has no
 * `routes`, so it does not count.
 */
async function pastReviews(jobId: string): Promise<PastReview[]> {
  const rows = await prisma.toolCall.findMany({
    where: { message: { jobId }, toolName: TOOL_NAME, status: ToolCallStatus.SUCCESS },
    orderBy: { createdAt: "asc" },
    select: { output: true },
  });
  const past: PastReview[] = [];
  for (const { output } of rows) {
    if (typeof output !== "object" || output === null || Array.isArray(output)) continue;
    const { routes, summary } = output as { routes?: unknown; summary?: unknown };
    if (!Array.isArray(routes) || typeof summary !== "string") continue;
    past.push({ routes: routes.filter((r): r is string => typeof r === "string"), review: summary });
  }
  return past;
}

/**
 * The picture the user gave to make the app look like, when they gave one: it
 * is stored with the project, and the review compares the app with it. Any
 * trouble reading it costs the review its reference, not the run its review.
 */
async function referenceOf(
  projectId: string,
  userId: string,
): Promise<{ bytes: Uint8Array; mimeType: string } | undefined> {
  try {
    const row = await prisma.project.findUnique({ where: { id: projectId }, select: { designConfig: true } });
    const reference = normalizeDesignConfig(row?.designConfig)?.reference;
    if (!reference) return undefined;
    const bytes = await withDeadline(
      getObjectBytes(designReferenceKey(userId, reference.hash)),
      10_000,
      "reading the reference picture",
    );
    return { bytes, mimeType: reference.mimeType };
  } catch (err) {
    log.warn("design.review.reference_unreadable", { projectId, error: String(err).slice(0, 200) });
    return undefined;
  }
}

/**
 * `dispatch_design_reviewer`: show the app to a model that can see, and return
 * what it finds wrong.
 *
 * Named and listed with the other sub-agents because that is what it is to the
 * agent calling it — work handed off, a written report back — though inside it
 * is one model call over screenshots rather than a tool-using loop
 * (`worker/design/review.ts`).
 *
 * The report comes back as `summary`, the field every `dispatch_*` tool uses,
 * so the chat shows it the way it shows a verifier's. `next` is tau's own
 * instruction on what to do with it: which findings must be fixed, and whether
 * these screens can be looked at again.
 */
export async function dispatchDesignReviewer(
  input: unknown,
  sandbox: Sandbox,
  jobId: string,
  projectId: string,
  userId: string,
  indexer: () => number,
) {
  if (!designReviewAvailable()) {
    return {
      unavailable: true,
      summary:
        "Design review is not available on this tau instance, so nothing was reviewed. Carry on without it; do not call this again.",
    };
  }

  const { paths, focus, steps } = (input ?? {}) as { paths?: unknown; focus?: unknown; steps?: unknown };
  const plan = planReview(paths, await pastReviews(jobId).catch(() => []));
  const refused = refusal(plan);
  if (refused) {
    log.info("design.review.refused", {
      jobId,
      projectId,
      closed: plan.closed,
      exhausted: plan.exhausted,
    });
    return { refused: true, summary: refused };
  }

  const routes = [...plan.fresh, ...plan.recheck];
  const reference = await referenceOf(projectId, userId);
  // A stalled read costs the review its design, not the run its reviewer.
  const designMd = await withDeadline(
    readOrNull(sandbox, DESIGN_PATH),
    10_000,
    `reading ${DESIGN_PATH}`,
  ).catch(() => null);

  let result;
  try {
    result = await reviewDesign({
      previewUrl: `https://${sandbox.getHost(PREVIEW_PORT)}`,
      fresh: plan.fresh,
      recheck: plan.recheck,
      earlier: plan.earlier,
      designProse: designMd ? designProse(designMd) : null,
      focus: typeof focus === "string" ? focus : undefined,
      steps: reviewSteps(steps, routes),
      ...(reference ? { reference } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn("design.review.failed", { jobId, projectId, routes, error: message });
    return {
      error: `The screens could not be reviewed: ${message} If a screen rendered blank, the app is probably not compiling — check that first (\`bunx tsc -p tsconfig.app.json --noEmit\`), then try once more.`,
    };
  }

  await meterModelCall({ userId, projectId, jobId, indexer }, result.usage, "design review");
  log.info("design.review", {
    jobId,
    projectId,
    routes,
    recheck: plan.recheck,
    verdict: result.verdict,
    screens: result.screens.length,
    steps: result.screens.filter((s) => s.state).length,
    reference: Boolean(reference),
    captureMs: result.captureMs,
    modelMs: result.modelMs,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    ...(result.skipped.length > 0 ? { skipped: result.skipped } : {}),
  });

  // Only what was actually seen counts as a look at it.
  const seen = routes.filter((r) => result.screens.some((s) => s.path === r));
  const cut = result.screens.filter((s) => s.capturedHeight < s.pageHeight && !s.state);
  const left = [
    ...plan.overLimit.map((r) => `${r}: only ${MAX_REVIEW_PATHS} screens fit in one review — call again for it`),
    ...plan.closed.map((r) => `${r}: has had its review and its re-check this run`),
    ...result.skipped,
  ];
  return {
    verdict: result.verdict,
    routes: seen,
    ...(plan.recheck.length > 0 ? { recheck: plan.recheck.filter((r) => seen.includes(r)) } : {}),
    summary: result.review,
    next: nextStep(
      { fresh: plan.fresh.filter((r) => seen.includes(r)), recheck: plan.recheck.filter((r) => seen.includes(r)) },
      result.verdict,
    ),
    ...(cut.length > 0
      ? {
          note: `Only the top of ${cut.length === 1 ? "one long screen" : "some long screens"} was looked at closely; the rest was seen shrunk to one picture, which shows layout and not small text.`,
        }
      : {}),
    ...(left.length > 0 ? { notReviewed: left } : {}),
  };
}
