import { env } from "@/lib/env";
import { bus, type DispatchPayload } from "@/lib/bus";
import { prisma } from "@/lib/prisma";
import { publish, publishTerminal } from "./lib/publish";
import { captureException, log } from "./lib/log";
import { provisionSandbox } from "./lib/sandbox";
import { announceAvailablePreview } from "./lib/previewAvailability";
import { previewNeedsScreenshot } from "./lib/previewScreenshot";
import { logGatewayReachability } from "./lib/aiEnv";
import {
  AgentStopError,
  captureProjectScreenshot,
  runAgentLoop,
} from "./agent/loop";
import { InsufficientCreditsError, chargeFlat, settle } from "@/lib/credits";
import { PUBLISH_FEE_MICRO, toCredits } from "@/lib/pricing";
import { finalizeJobRollups } from "./lib/jobRollups";
import { PREVIEW_PORT } from "./agent/config";
import { buildAndUpload, DeployError } from "./lib/deploy";
import { publicSiteUrl } from "@/lib/sites";
import { invalidateSiteLookup } from "@/api/lib/siteLookup";
import { isDraining } from "@/lib/lifecycle";
import {
  DeploymentStatus,
  FinishReason,
  JobStatus,
  JobType,
  LedgerType,
  type Effort,
} from "@/generated/prisma/enums";

async function runPreviewJob(payload: DispatchPayload): Promise<void> {
  const { jobId, projectId, userId } = payload;

  await prisma.job.update({
    where: { id: jobId },
    data: { status: JobStatus.RUNNING, startedAt: new Date() },
  });
  await publish(jobId, { type: "thinking", message: "Starting preview" });

  // Reconnect-or-rebuild + rehydrate from R2. The template's start command
  // auto-runs Vite on PREVIEW_PORT, so the returned sandbox is serving the app.
  const sandbox = await provisionSandbox(projectId, userId, jobId);
  const previewUrl = `https://${sandbox.getHost(PREVIEW_PORT)}`;

  await announceAvailablePreview(jobId, projectId, previewUrl);

  // Cover maintenance must never turn an otherwise successful preview restart
  // into a failed job, including when its freshness lookup fails.
  const needsScreenshot = env.SCREENSHOT_ENABLED
    ? await previewNeedsScreenshot(projectId).catch((err) => {
        captureException(err, { jobId, projectId, detail: "cover freshness check failed" });
        return false;
      })
    : false;

  if (!env.SCREENSHOT_ENABLED) {
    log.warn("screenshot.capture.disabled", {
      jobId,
      projectId,
      source: "preview",
    });
  } else if (needsScreenshot) {
    log.info("screenshot.capture.start", { jobId, projectId, source: "preview" });
    await captureProjectScreenshot(projectId, userId, previewUrl).catch((err) =>
      captureException(err, {
        jobId,
        projectId,
        detail: "preview screenshot failed",
      }),
    );
  } else {
    log.info("screenshot.capture.skipped", {
      jobId,
      projectId,
      reason: "cover_current",
    });
  }

}

/**
 * Publish a project: build it in its sandbox, copy the static output to R2, and
 * move the project's live pointer onto the new deployment.
 *
 * The pointer moves last, and only after the final byte is uploaded, so a
 * failure at any point leaves the previously published site serving untouched.
 * Nothing here is undone on failure either — the abandoned prefix is dead bytes
 * under a deployment id nothing points at, which the sweep can reclaim later,
 * and deleting it eagerly would only add a second way to fail.
 */
async function runDeployJob(payload: DispatchPayload): Promise<void> {
  const { jobId, projectId, userId } = payload;

  const deployment = await prisma.deployment.findUnique({ where: { jobId } });
  if (!deployment) {
    // The row is written in the same transaction that creates the job, so this
    // is unreachable short of a manual delete. Fail loudly rather than build.
    throw new Error(`No deployment row for job ${jobId}`);
  }

  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.RUNNING,
      startedAt: new Date(),
      lastHeartbeatAt: new Date(),
    },
  });
  await prisma.deployment.update({
    where: { id: deployment.id },
    data: { status: DeploymentStatus.BUILDING },
  });
  await publish(jobId, { type: "thinking", message: "Preparing your app" });

  try {
    const sandbox = await provisionSandbox(projectId, userId, jobId);

    const outcome = await buildAndUpload({
      sandbox,
      storagePrefix: deployment.storagePrefix,
      jobId,
      projectId,
      onProgress: async ({ phase, message }) => {
        if (phase === "uploading") {
          await prisma.deployment.update({
            where: { id: deployment.id },
            data: { status: DeploymentStatus.UPLOADING },
          });
        }
        await publish(jobId, { type: "thinking", message });
      },
    });

    // The live pointer and the new row's status move together: a READY
    // deployment nothing points at, or a pointer at a row still marked
    // UPLOADING, are both states the UI would have to guess about.
    const { previousLiveId, slug } = await prisma.$transaction(async (tx) => {
      const project = await tx.project.findUniqueOrThrow({
        where: { id: projectId },
        select: { liveDeploymentId: true, slug: true, publishFeePaidAt: true },
      });

      // The first publish of a project is paid for here, in the transaction that
      // makes it live, so the fee and the site commit together or not at all. A
      // build that failed never got this far and cost nothing. The balance may
      // have fallen since the request checked it; then this throws and the
      // whole transaction, including the READY row, rolls back.
      if (project.publishFeePaidAt === null) {
        await chargeFlat(
          userId,
          PUBLISH_FEE_MICRO,
          `publish-fee:${projectId}`,
          LedgerType.PUBLISH_FEE,
          "first publish",
          { enforce: env.CREDITS_ENFORCE, tx },
        );
        await tx.project.update({
          where: { id: projectId },
          data: { publishFeePaidAt: new Date() },
        });
      }

      await tx.deployment.update({
        where: { id: deployment.id },
        data: {
          status: DeploymentStatus.READY,
          outputDir: outcome.outputDir,
          fileCount: outcome.fileCount,
          sizeBytes: outcome.sizeBytes,
          buildLog: outcome.buildLog,
          error: outcome.warning ?? null,
          completedAt: new Date(),
        },
      });

      if (project.liveDeploymentId && project.liveDeploymentId !== deployment.id) {
        await tx.deployment.updateMany({
          where: {
            id: project.liveDeploymentId,
            status: DeploymentStatus.READY,
          },
          // The rollback window starts now, when it stops serving, not when it
          // was built (`deploySweep.ts`).
          data: {
            status: DeploymentStatus.SUPERSEDED,
            supersededAt: new Date(),
          },
        });
      }

      await tx.project.update({
        where: { id: projectId },
        data: { liveDeploymentId: deployment.id },
      });

      return { previousLiveId: project.liveDeploymentId, slug: project.slug };
    });

    // The slug is allocated when the publish is requested, so by here it always
    // exists; the fallback only keeps a missing one from throwing on a build
    // that otherwise succeeded.
    const url = slug ? publicSiteUrl(slug) : null;
    // The site handler caches slug → prefix for a few seconds. Drop the entry
    // now so the link we are about to hand the user serves the build they just
    // made, rather than the previous one until the TTL lapses.
    if (slug) invalidateSiteLookup(slug);
    log.info("deploy.done", {
      jobId,
      projectId,
      deploymentId: deployment.id,
      previousLiveId,
      files: outcome.fileCount,
      sizeBytes: outcome.sizeBytes,
    });

    await publish(jobId, {
      type: "deploy_ready",
      url,
      deploymentId: deployment.id,
      warning: outcome.warning ?? null,
    });
  } catch (raised) {
    // A balance that fell short between the request and going live is the
    // owner's to fix, not an outage.
    const err: unknown =
      raised instanceof InsufficientCreditsError
        ? new DeployError(
            `Not enough credits to publish. A project's first publish costs ${toCredits(PUBLISH_FEE_MICRO)} credits. Nothing was charged.`,
          )
        : raised;
    const isUserFacing = err instanceof DeployError;
    await prisma.deployment
      .update({
        where: { id: deployment.id },
        data: {
          status: DeploymentStatus.FAILED,
          error: isUserFacing
            ? err.message
            : "Something went wrong while publishing. Try again.",
          buildLog: isUserFacing ? (err.buildLog ?? null) : null,
          completedAt: new Date(),
        },
      })
      .catch((e) =>
        captureException(e, { jobId, detail: "deployment failure update" }),
      );
    throw err;
  }

}

/**
 * Process a single code-generation job: run the agent loop, handle in-flight
 * cancellation, and settle credits on terminal status. Economy (Redis-free):
 * cancellation and event indexing go through the in-process bus. A PREVIEW-type
 * job short-circuits to {@link runPreviewJob} instead of the agent loop.
 */
export async function processJob(payload: DispatchPayload): Promise<void> {
  // Tell the reaper this process owns the job, so a stale heartbeat during one
  // long turn isn't mistaken for an abandoned run (api/src/lib/jobs.ts).
  bus.markResident(payload.jobId, {
    projectId: payload.projectId,
    userId: payload.userId,
    effort: payload.effort,
  });
  try {
    await runJob(payload);
  } finally {
    bus.clearResident(payload.jobId);
  }
}

async function runJob(payload: DispatchPayload): Promise<void> {
  const { jobId, projectId, userId, prompt, effort } = payload;

  if (payload.type === JobType.PREVIEW) {
    try {
      await runPreviewJob(payload);
      await prisma.job.update({
        where: { id: jobId },
        data: {
          status: JobStatus.COMPLETED,
          completedAt: new Date(),
          finishReason: FinishReason.DONE,
        },
      });
      await publishTerminal(jobId, { type: "done" });
    } catch (err) {
      captureException(err, { jobId, projectId, userId, phase: "preview" });
      await markFailed(jobId, err, "Couldn't start the preview");
    }
    return;
  }

  if (payload.type === JobType.DEPLOY) {
    try {
      await runDeployJob(payload);
      await prisma.job.update({
        where: { id: jobId },
        data: {
          status: JobStatus.COMPLETED,
          completedAt: new Date(),
          finishReason: FinishReason.DONE,
        },
      });
      await publishTerminal(jobId, { type: "done" });
    } catch (err) {
      // A DeployError is the user's build not compiling, not our bug — it says
      // what to do next, so pass it through instead of burying it under a
      // generic message, and don't page anyone about it.
      if (!(err instanceof DeployError)) {
        captureException(err, { jobId, projectId, userId, phase: "deploy" });
      }
      await markFailed(
        jobId,
        err,
        err instanceof DeployError ? err.message : "Couldn't publish your app",
      );
    }
    return;
  }

  let cancelled = false;

  const offCancel = bus.onCancel(jobId, () => {
    void (async () => {
      cancelled = true;
      try {
        const cancelledRow = await prisma.job.updateMany({
          where: { id: jobId, status: { in: [JobStatus.QUEUED, JobStatus.RUNNING] } },
          data: {
            status: JobStatus.CANCELLED,
            completedAt: new Date(),
            finishReason: FinishReason.CANCELLED,
          },
        });
        if (cancelledRow.count === 0) return;
        await settle(jobId);
        await publishTerminal(jobId, { type: "cancelled" });
      } catch (err) {
        captureException(err, { jobId, event: "job.cancel.failed" });
      }
    })();
  });

  try {
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.RUNNING,
        startedAt: new Date(),
        // Start the heartbeat here: provisioning a sandbox can take a while and
        // must not look like a stalled job to the reaper.
        lastHeartbeatAt: new Date(),
      },
    });

    await publish(jobId, { type: "thinking", message: "Thinking" });
    log.info("job.start", { jobId, projectId, userId, effort });

    bus.setPhase(jobId, "provisioning");
    const hasFiles =
      (await prisma.projectFile.count({ where: { projectId } })) > 0;
    const initialSandbox = hasFiles
      ? await provisionSandbox(projectId, userId, jobId)
      : undefined;
    if (initialSandbox) {
      bus.setPhase(jobId, "llm", { sandboxId: initialSandbox.sandboxId });
      await prisma.job
        .update({
          where: { id: jobId },
          data: { sandboxId: initialSandbox.sandboxId },
        })
        .catch(() => {});
    }

    const finishReason = await runAgentLoop(
      jobId,
      projectId,
      userId,
      prompt,
      effort as Effort,
      initialSandbox,
    );

    if (!cancelled) {
      const completed = await prisma.job.updateMany({
        where: { id: jobId, status: JobStatus.RUNNING },
        data: {
          status: JobStatus.COMPLETED,
          completedAt: new Date(),
          finishReason,
        },
      });
      if (completed.count === 0) return; // cancellation won the race
      await settle(jobId).catch((err) =>
        captureException(err, { jobId, detail: "settle failed on complete" }),
      );
      await finalizeJobRollups(jobId).catch((err) =>
        captureException(err, { jobId, detail: "rollup failed on complete" }),
      );
      log.info("job.finish", { jobId, projectId, userId, finishReason });
      await publishTerminal(jobId,
        finishReason === FinishReason.BUDGET || finishReason === FinishReason.INSUFFICIENT_CREDITS
          ? { type: "insufficient_credits", reason: finishReason === FinishReason.BUDGET ? "budget" : "balance" }
          : { type: "done" },
      );
    }
  } finally {
    offCancel();
  }
}

/**
 * Terminate a job for good: mark it FAILED, release its hold, and — critically —
 * emit the terminal frame.
 *
 * Every failure path funnels through here, including the ones that used to
 * publish nothing at all (a `provisionSandbox` throw, a DB blip while flipping
 * the row to RUNNING). Those left the browser shimmering with no explanation
 * until a poll happened to notice (doc/STUCK_THINKING_AND_TOOL_MESSAGES.md §2.3).
 *
 * Deliberately called only when the runner has stopped retrying: a frame emitted
 * on a non-final attempt tears the client's stream down, so the retry would run
 * with nobody listening (§2.4).
 */
async function markFailed(
  jobId: string,
  err: unknown,
  userMessage?: string,
): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  // A guard rail that fired names itself; anything else is an opaque failure.
  const finishReason =
    err instanceof AgentStopError ? err.finishReason : FinishReason.ERROR;
  const failed = await prisma.job
    .updateMany({
      where: { id: jobId, status: { in: [JobStatus.QUEUED, JobStatus.RUNNING] } },
      data: {
        status: JobStatus.FAILED,
        error: message,
        completedAt: new Date(),
        finishReason,
      },
    })
    .catch((e) => {
      captureException(e, { jobId, detail: "failed-status update" });
      return null;
    });
  if (!failed) {
    // The database will be reconciled by the reaper when it recovers. A live
    // browser still needs an ending instead of an endless thinking state.
    await publishTerminal(jobId, {
      type: "error",
      message: userMessage ?? "This run stopped unexpectedly. Please try again.",
    });
    return;
  }
  if (failed.count === 0) return;
  await settle(jobId).catch((e) =>
    captureException(e, { jobId, detail: "settle failed on job failure" }),
  );
  // A failed run still spent tokens — roll them up so cost reporting is not
  // silently blind to exactly the jobs worth investigating.
  await finalizeJobRollups(jobId).catch((e) =>
    captureException(e, { jobId, detail: "rollup failed on job failure" }),
  );
  await publishTerminal(jobId, {
    type: "error",
    message: userMessage ?? message,
  }).catch((e) =>
    captureException(e, { jobId, detail: "terminal publish failed" }),
  );
}

/** Shown to a user whose job was queued, but not started, when a deploy began. */
const RESTARTING_MESSAGE =
  "tau is restarting for an update. Please send that again in a minute.";

/** Set by {@link startRunner}; see {@link drainRunner}. */
let drain: ((timeoutMs: number) => Promise<number>) | null = null;

/**
 * Stop the runner for a graceful shutdown: jobs waiting in the queue are failed
 * now (their holds released, their browsers told why), and jobs already running
 * get up to `timeoutMs` to finish. Resolves with the number still running when
 * it gave up — 0 means a clean drain. Whatever is left is reaped on next boot.
 *
 * The caller must have called `startDraining()` first so nothing new starts.
 */
export function drainRunner(timeoutMs: number): Promise<number> {
  return drain ? drain(timeoutMs) : Promise.resolve(0);
}

/**
 * Start the in-process job runner (economy): consume dispatched jobs with a
 * concurrency limit and one retry, replacing the BullMQ worker. No Redis, no
 * durability — a process restart drops queued/in-flight jobs (accepted
 * tradeoff, see doc/economy-deployment.md).
 *
 * Idempotent across `bun --hot` reloads: the `bus` is a process-global
 * singleton that outlives this module, so any dispatch handler left over from a
 * previous execution is swept before a fresh one is wired. Without this, each
 * reload would accumulate another handler and a single dispatched job would run
 * once per handler — the model appears to "respond" several times over.
 */
export function startRunner(): void {
  bus.clearDispatchHandlers();

  // One line at boot for a misconfiguration whose only other symptom is a
  // generated app that 502s on every AI call, hours later, in logs nobody is
  // watching. Does not stop the runner: a tau instance with a broken gateway
  // URL still builds every non-AI app perfectly well.
  logGatewayReachability();

  const MAX_ATTEMPTS = 2; // mirror BullMQ attempts: 2 (initial + 1 retry)
  const queue: DispatchPayload[] = [];
  const attempts = new Map<string, number>();
  let active = 0;

  // Mirror the runner's counters onto the bus so queue depth and in-flight
  // count are answerable from an HTTP handler (GET /admin/health) instead of
  // existing only as locals nobody outside this closure can see.
  const publishStats = (): void =>
    bus.setRunnerStats({
      queueDepth: queue.length,
      active,
      concurrency: env.WORKER_CONCURRENCY,
    });

  const pump = (): void => {
    while (!isDraining() && active < env.WORKER_CONCURRENCY && queue.length > 0) {
      const payload = queue.shift();
      if (!payload) break;
      active += 1;
      publishStats();
      void runOne(payload).finally(() => {
        active -= 1;
        publishStats();
        pump();
      });
    }
    publishStats();
  };

  const runOne = async (payload: DispatchPayload): Promise<void> => {
    try {
      await processJob(payload);
      attempts.delete(payload.jobId);
    } catch (err) {
      const n = (attempts.get(payload.jobId) ?? 0) + 1;
      // A cancelled job is already terminal — retrying it would resurrect a run
      // the user explicitly stopped.
      // No retry while draining either: it would only be queued and dropped.
      if (n < MAX_ATTEMPTS && !bus.isCancelled(payload.jobId) && !isDraining()) {
        attempts.set(payload.jobId, n);
        captureException(err, {
          jobId: payload.jobId,
          projectId: payload.projectId,
          userId: payload.userId,
          attempt: n,
          maxAttempts: MAX_ATTEMPTS,
          willRetry: true,
        });
        // No terminal frame here on purpose: publishing one would make the
        // client finalize and close its stream, so the retry would run with
        // nobody listening (§2.4). The browser keeps shimmering through it.
        await prisma.job
          .update({
            where: { id: payload.jobId },
            data: { attemptNumber: n + 1, lastHeartbeatAt: new Date() },
          })
          .catch(() => {});
        queue.push(payload);
      } else {
        attempts.delete(payload.jobId);
        captureException(err, {
          jobId: payload.jobId,
          projectId: payload.projectId,
          userId: payload.userId,
          attempt: n,
          willRetry: false,
        });
        await markFailed(payload.jobId, err);
      }
    }
  };

  bus.onDispatch((payload) => {
    // A request that slipped in on a kept-alive connection after SIGTERM. It
    // would never start, so end it now rather than leave it for the reaper.
    if (isDraining()) {
      void markFailed(payload.jobId, new Error("server draining"), RESTARTING_MESSAGE);
      return;
    }
    queue.push(payload);
    pump();
  });

  drain = async (timeoutMs) => {
    const waiting = queue.splice(0);
    publishStats();
    await Promise.all(
      waiting.map((p) =>
        markFailed(p.jobId, new Error("server draining"), RESTARTING_MESSAGE),
      ),
    );

    const deadline = Date.now() + timeoutMs;
    while (active > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 250));
    }
    return active;
  };

  publishStats();
  log.info("runner.ready", {
    concurrency: env.WORKER_CONCURRENCY,
    transport: "in-process",
  });
}

// Signal handling lives in src/index.ts, which owns the whole process and drains
// the runner before exiting. This standalone entry only needs a plain exit.
if (import.meta.main) {
  startRunner();
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      log.info("runner.shutdown", { signal });
      void prisma.$disconnect().finally(() => process.exit(0));
    });
  }
}
