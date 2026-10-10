import { IN_FLIGHT_DEPLOYMENT_STATUSES } from "@/lib/deployStatus";
import { prisma } from "@/lib/prisma";
import { bus } from "@/lib/bus";
import { settle } from "@/lib/credits";
import {
  DeploymentStatus,
  FinishReason,
  JobStatus,
} from "@/generated/prisma/enums";

/**
 * How long a non-terminal job may go without a heartbeat before the reaper
 * declares it dead. The agent loop bumps `lastHeartbeatAt` every turn, and a
 * single turn is bounded by the LLM client's request timeout (4 min) plus tool
 * execution, so this is comfortably above a slow-but-healthy turn.
 */
const HEARTBEAT_GRACE_MS = 15 * 60_000;

/**
 * Grace for a job that has never heartbeat at all — it is still QUEUED, or was
 * picked up but died before its first turn. Measured from `queuedAt`.
 */
const STARTUP_GRACE_MS = 10 * 60_000;

/**
 * Hard ceiling on protecting a job just because it is resident. Residency
 * normally means "alive, just mid-turn", but a run wedged below the agent
 * loop's own wall-clock check (which only fires at turn boundaries) would
 * otherwise be shielded forever. Comfortably above the largest effort budget.
 */
const MAX_RESIDENT_MS = 3 * 60 * 60_000;

/** Anything queued before this instant belongs to a previous process. */
const PROCESS_STARTED_AT = new Date();

export interface ReapResult {
  reaped: number;
  jobIds: string[];
  errors: string[];
}

/**
 * Tear down a job whose owning process is gone: mark the row terminal, release
 * the hold, and unstick any browser still watching.
 *
 * Shared by the reaper and by the cancel endpoint, which reaches a job nobody is
 * running — for those, `bus.requestCancel` signals nobody and the row would sit
 * there forever. Idempotent: a no-op once the row is already terminal.
 */
export async function terminateStrandedJob(
  jobId: string,
  opts: {
    status?: JobStatus;
    reason?: FinishReason;
    message?: string;
  } = {},
): Promise<boolean> {
  const {
    status = JobStatus.FAILED,
    reason = FinishReason.ABANDONED,
    message = "This run stopped unexpectedly. Send another message to continue where it left off.",
  } = opts;

  const { count } = await prisma.job.updateMany({
    // The status guard makes this a compare-and-set: concurrent callers (reaper
    // + cancel, or two reapers) can't both "terminate" the same job.
    where: { id: jobId, status: { in: [JobStatus.QUEUED, JobStatus.RUNNING] } },
    data: {
      status,
      error: message,
      finishReason: reason,
      completedAt: new Date(),
    },
  });
  if (count === 0) return false;

  // A DEPLOY job owns a Deployment row that is mid-flight in its own state
  // machine. Left alone it stays BUILDING forever, and since the Publish panel
  // reads that as "a publish is in progress", the button would be disabled for
  // good — the same class of wreckage this reaper exists to clean up on the Job
  // row. Guarded on the non-terminal statuses so it cannot demote a deployment
  // that finished while the reaper was deciding.
  await prisma.deployment
    .updateMany({
      where: {
        jobId,
        status: { in: IN_FLIGHT_DEPLOYMENT_STATUSES },
      },
      data: {
        status: DeploymentStatus.FAILED,
        error: "This publish stopped unexpectedly. Try publishing again.",
        completedAt: new Date(),
      },
    })
    .catch(() => {});

  // Frees the concurrency slot. Pay-as-you-go: never refunds spent credits.
  await settle(jobId);

  // Unstick any browser still watching. A no-op when nobody is listening — a
  // client that connects later sees `activeJobId === null` and finalizes itself.
  if (bus.claimTerminal(jobId)) {
    bus.emit(jobId, { type: "error", message, index: bus.nextIndex(jobId) });
  }
  return true;
}

/**
 * Terminate jobs whose owning process is gone.
 *
 * The economy runner is in-process with no durability: a crash, OOM, redeploy or
 * idle spin-down leaves the `Job` row at RUNNING forever. Nothing else reconciles
 * it, and the consequences compound —
 *
 *   - `findActiveJob` keeps returning it, so `/project/:id` reports an
 *     `activeJobId` and the browser re-arms the "thinking" shimmer on every
 *     load, permanently;
 *   - `addMessage` rejects every subsequent prompt on that project with 409
 *     "generation in progress", bricking the project;
 *   - its `CreditHold` stays ACTIVE, consuming one of the user's concurrency
 *     slots for good.
 *
 * See doc/STUCK_THINKING_AND_TOOL_MESSAGES.md §2.1. Runs on boot (where every
 * non-terminal row is provably orphaned, since the process that owned them just
 * died) and hourly thereafter to catch mid-life hangs.
 *
 * @param onBoot skip the grace periods — nothing can legitimately be running yet.
 */
export async function reapStaleJobs(onBoot = false): Promise<ReapResult> {
  const now = Date.now();
  const heartbeatCutoff = new Date(now - (onBoot ? 0 : HEARTBEAT_GRACE_MS));
  const startupCutoff = new Date(now - (onBoot ? 0 : STARTUP_GRACE_MS));

  const stale = await prisma.job.findMany({
    where: {
      status: { in: [JobStatus.QUEUED, JobStatus.RUNNING] },
      // The boot pass runs concurrently with the server accepting traffic, so
      // bound it to rows that predate this process. Without this a prompt
      // submitted in the first moments of startup could be reaped as "stranded"
      // before the runner ever picked it up.
      ...(onBoot ? { queuedAt: { lt: PROCESS_STARTED_AT } } : {}),
      OR: [
        { lastHeartbeatAt: { lt: heartbeatCutoff } },
        { lastHeartbeatAt: null, queuedAt: { lt: startupCutoff } },
      ],
    },
    select: { id: true },
  });

  const errors: string[] = [];
  const jobIds: string[] = [];

  for (const job of stale) {
    // A job this process is executing is alive even if its heartbeat is stale —
    // it just hasn't reached a turn boundary. Never reap one out from under the
    // runner; it would keep writing to a row marked FAILED. Past MAX_RESIDENT_MS
    // that protection lapses: at that point it is wedged, not working.
    if (!onBoot) {
      const residentFor = bus.residentForMs(job.id);
      if (residentFor !== null && residentFor < MAX_RESIDENT_MS) continue;
    }

    try {
      if (await terminateStrandedJob(job.id)) jobIds.push(job.id);
    } catch (err) {
      errors.push(
        `${job.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { reaped: jobIds.length, jobIds, errors };
}
