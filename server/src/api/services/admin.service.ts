import argon2 from "argon2";
import { prisma } from "@/lib/prisma";
import { bus, type JobRegistryEntry } from "@/lib/bus";
import { env } from "@/lib/env";
import { Errors } from "../lib/errors";
import { settle } from "@/lib/credits";
import { terminateStrandedJob, reapStaleJobs } from "../lib/jobs";
import { toCredits } from "@/lib/pricing";
import {
  FinishReason,
  HoldStatus,
  JobStatus,
  Role,
  SandboxStatus,
  ToolCallStatus,
} from "@/generated/prisma/enums";

/**
 * A job with no heartbeat for this long is "stuck" for alerting purposes.
 * Tighter than the reaper's own grace period (15 min) on purpose: the point of
 * the metric is to notice *before* the reaper has to clean up.
 */
export const STUCK_AFTER_MS = 5 * 60_000;

const PROCESS_STARTED_AT = Date.now();

const NON_TERMINAL = [JobStatus.QUEUED, JobStatus.RUNNING] as const;

// ── console sign-in ──────────────────────────────────────────────────────────

/**
 * Verify email + password and that the account carries the ADMIN role.
 *
 * Deliberately does *not* go through `auth.service.login`: that issues a full
 * token pair and writes a `RefreshToken` row, which is a session for the whole
 * product. Signing into the ops console should mint one short-lived,
 * `/admin`-scoped cookie and nothing else.
 *
 * A wrong password and a non-existent account return the same error. Failing
 * the role check returns a different one on purpose — at that point the caller
 * has already proven the account is theirs, so "you are not an admin" tells
 * them nothing they couldn't learn by logging into the app.
 */
export async function authenticateAdmin(
  email?: string,
  password?: string,
): Promise<{ id: string; email: string; via: string }> {
  const invalid = Errors.unauthorized("Invalid credentials");
  if (!email || !password) throw invalid;

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, passwordHash: true, role: true },
  });

  // No password hash means an OAuth-only account — there is nothing to verify
  // here, and those operators sign in with a bearer token instead.
  if (!user?.passwordHash) throw invalid;
  if (!(await argon2.verify(user.passwordHash, password))) throw invalid;
  if (user.role !== Role.ADMIN) throw Errors.forbidden("Admin access required");

  return { id: user.id, email: user.email, via: "password" };
}

// ── health ───────────────────────────────────────────────────────────────────

export interface AdminHealth {
  ok: boolean;
  queueDepth: number;
  active: number;
  concurrency: number;
  residentJobs: number;
  stuckJobs: number;
  activeHolds: number;
  orphanHolds: number;
  uptimeSeconds: number;
  memoryMB: number;
}

/**
 * The one endpoint to page on. `ok` is false when anything here needs a human —
 * an external uptime check pointed at this catches the process-death case (§2.1)
 * from outside, which nothing internal can.
 */
export async function getHealth(): Promise<AdminHealth> {
  const runner = bus.runnerSnapshot();
  const cutoff = new Date(Date.now() - STUCK_AFTER_MS);

  const [stuckJobs, activeHolds, orphanHolds] = await Promise.all([
    prisma.job.count({
      where: {
        status: { in: [...NON_TERMINAL] },
        OR: [
          { lastHeartbeatAt: { lt: cutoff } },
          { lastHeartbeatAt: null, queuedAt: { lt: cutoff } },
        ],
      },
    }),
    prisma.creditHold.count({ where: { status: HoldStatus.ACTIVE } }),
    countOrphanHolds(),
  ]);

  return {
    ok: stuckJobs === 0 && orphanHolds === 0,
    queueDepth: runner.queueDepth,
    active: runner.active,
    concurrency: runner.concurrency,
    residentJobs: bus.registrySnapshot().length,
    stuckJobs,
    activeHolds,
    orphanHolds,
    uptimeSeconds: Math.round((Date.now() - PROCESS_STARTED_AT) / 1000),
    memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
  };
}

/** ACTIVE holds whose job is already terminal (or gone) — leaked concurrency. */
async function countOrphanHolds(): Promise<number> {
  const rows = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count
    FROM "CreditHold" ch
    LEFT JOIN "Job" j ON j.id = ch."jobId"
    WHERE ch.status = 'ACTIVE'
      AND (j.id IS NULL OR j.status IN ('COMPLETED', 'FAILED', 'CANCELLED'))
  `;
  return Number(rows[0]?.count ?? 0);
}

// ── job list ─────────────────────────────────────────────────────────────────

export interface AdminJobListItem {
  id: string;
  projectId: string;
  userId: string | null;
  status: JobStatus;
  type: string;
  effort: string;
  finishReason: FinishReason | null;
  model: string | null;
  attemptNumber: number;
  currentTurn: number;
  queuedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  ageSeconds: number;
  heartbeatAgeSeconds: number | null;
  inputTokens: number;
  outputTokens: number;
  credits: number;
  error: string | null;
  /** Live state, present only while this process is executing the job. */
  live: (JobRegistryEntry & { phaseAgeSeconds: number }) | null;
  stuck: boolean;
}

export interface AdminJobListQuery {
  status?: string;
  userId?: string;
  projectId?: string;
  since?: string;
  limit?: number;
}

/**
 * Job list, newest-terminal-last. The default view is deliberately *everything
 * non-terminal, oldest first*: a stuck job is the oldest thing still claiming to
 * be running, so it floats to the top without anyone having to filter for it.
 */
export async function listJobs(
  q: AdminJobListQuery,
): Promise<AdminJobListItem[]> {
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
  const filterActive = !q.status || q.status === "active";

  const where = {
    ...(filterActive
      ? { status: { in: [...NON_TERMINAL] } }
      : q.status === "all"
        ? {}
        : { status: q.status as JobStatus }),
    ...(q.projectId ? { projectId: q.projectId } : {}),
    ...(q.since ? { queuedAt: { gte: new Date(q.since) } } : {}),
    ...(q.userId ? { project: { userId: q.userId } } : {}),
  };

  const jobs = await prisma.job.findMany({
    where,
    orderBy: filterActive ? { queuedAt: "asc" } : { queuedAt: "desc" },
    take: limit,
    include: { project: { select: { userId: true } } },
  });

  const now = Date.now();
  return jobs.map((j) => {
    const live = bus.registryEntry(j.id);
    const heartbeatAge = j.lastHeartbeatAt
      ? Math.round((now - j.lastHeartbeatAt.getTime()) / 1000)
      : null;
    const nonTerminal =
      j.status === JobStatus.QUEUED || j.status === JobStatus.RUNNING;
    return {
      id: j.id,
      projectId: j.projectId,
      userId: j.project?.userId ?? null,
      status: j.status,
      type: j.type,
      effort: j.effort,
      finishReason: j.finishReason,
      model: j.model,
      attemptNumber: j.attemptNumber,
      currentTurn: j.currentTurn,
      queuedAt: j.queuedAt,
      startedAt: j.startedAt,
      completedAt: j.completedAt,
      ageSeconds: Math.round((now - j.queuedAt.getTime()) / 1000),
      heartbeatAgeSeconds: heartbeatAge,
      inputTokens: j.inputTokens,
      outputTokens: j.outputTokens,
      credits: toCredits(j.costMicro),
      // `prompt` is deliberately absent — see ADMIN_ALLOW_CONTENT. `error` is
      // our own text, not the user's, so it stays.
      error: j.error,
      live: live
        ? {
            ...live,
            phaseAgeSeconds: Math.round((now - live.lastEventAt) / 1000),
          }
        : null,
      stuck:
        nonTerminal &&
        !live &&
        (heartbeatAge === null || heartbeatAge * 1000 > STUCK_AFTER_MS),
    };
  });
}

// ── job detail ───────────────────────────────────────────────────────────────

/**
 * Everything known about one run: the row, its timeline, every tool call with
 * duration and error, per-turn token usage, context checkpoints and the hold.
 *
 * User content (prompt, message bodies, tool input/output) is included only
 * when `ADMIN_ALLOW_CONTENT` is on. The shape stays identical either way so the
 * console renders the same — you just see `null` where the words would be.
 */
export async function getJobDetail(jobId: string) {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: { project: { select: { id: true, name: true, userId: true } } },
  });
  if (!job) throw Errors.notFound("Job not found");

  const allowContent = env.ADMIN_ALLOW_CONTENT;

  const [messages, usage, checkpoints, hold] = await Promise.all([
    prisma.message.findMany({
      where: { jobId },
      orderBy: { sequence: "asc" },
      include: {
        toolCalls: {
          orderBy: { createdAt: "asc" },
        },
      },
    }),
    prisma.tokenUsage.findMany({
      where: { jobId },
      orderBy: { recordedAt: "asc" },
      select: {
        model: true,
        inputTokens: true,
        outputTokens: true,
        recordedAt: true,
      },
    }),
    prisma.contextCheckpoint.findMany({
      where: { jobId },
      orderBy: { upToSequence: "asc" },
      select: {
        upToSequence: true,
        tokensBefore: true,
        tokensAfter: true,
        createdAt: true,
      },
    }),
    prisma.creditHold.findUnique({ where: { jobId } }),
  ]);

  return {
    job: {
      ...job,
      costMicro: job.costMicro.toString(),
      credits: toCredits(job.costMicro),
      prompt: allowContent ? job.prompt : null,
    },
    live: bus.registryEntry(jobId),
    timeline: messages.map((m) => ({
      id: m.id,
      sequence: m.sequence,
      role: m.role,
      type: m.type,
      createdAt: m.createdAt,
      inputTokens: m.inputTokens,
      outputTokens: m.outputTokens,
      content: allowContent ? m.content : null,
      toolCalls: m.toolCalls.map((tc) => ({
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        status: tc.status,
        error: tc.error,
        startedAt: tc.startedAt,
        completedAt: tc.completedAt,
        durationMs:
          tc.startedAt && tc.completedAt
            ? tc.completedAt.getTime() - tc.startedAt.getTime()
            : null,
        input: allowContent ? tc.input : null,
        output: allowContent ? tc.output : null,
      })),
    })),
    usage,
    checkpoints,
    hold: hold
      ? {
          status: hold.status,
          amount: hold.amount.toString(),
          consumed: hold.consumed.toString(),
          createdAt: hold.createdAt,
          settledAt: hold.settledAt,
        }
      : null,
    contentRedacted: !allowContent,
  };
}

/** The exact frames the user's browser received — replays a run frame by frame. */
export function getJobEvents(jobId: string) {
  return { jobId, events: bus.replay(jobId) };
}

// ── metrics ──────────────────────────────────────────────────────────────────

const WINDOWS = { "1h": 3_600_000, "24h": 86_400_000, "7d": 604_800_000 };

export interface WindowMetrics {
  window: string;
  jobs: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  successRate: number | null;
  finishReasons: Record<string, number>;
  p50DurationSeconds: number | null;
  p95DurationSeconds: number | null;
  /** queued → started: how long a user stared at "queued" before work began. */
  p50QueueWaitSeconds: number | null;
  p95QueueWaitSeconds: number | null;
  avgTurns: number | null;
  credits: number;
  creditsPerJob: number | null;
  byEffort: Record<string, { jobs: number; credits: number }>;
  toolCalls: number;
  toolFailures: number;
  toolFailureRate: number | null;
  topFailingTools: Array<{ tool: string; calls: number; failures: number }>;
  sandboxProvisionFailureRate: number | null;
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[idx] ?? null;
}

export async function getMetrics(): Promise<WindowMetrics[]> {
  return Promise.all(
    Object.entries(WINDOWS).map(([label, ms]) => metricsForWindow(label, ms)),
  );
}

async function metricsForWindow(
  label: string,
  ms: number,
): Promise<WindowMetrics> {
  const since = new Date(Date.now() - ms);

  const jobs = await prisma.job.findMany({
    where: { queuedAt: { gte: since } },
    select: {
      id: true,
      status: true,
      effort: true,
      finishReason: true,
      currentTurn: true,
      costMicro: true,
      queuedAt: true,
      startedAt: true,
      completedAt: true,
    },
  });

  const durations: number[] = [];
  const waits: number[] = [];
  const finishReasons: Record<string, number> = {};
  const byEffort: Record<string, { jobs: number; credits: number }> = {};
  let succeeded = 0;
  let failed = 0;
  let cancelled = 0;
  let turnSum = 0;
  let turnCount = 0;
  let costTotal = 0n;

  for (const j of jobs) {
    if (j.status === JobStatus.COMPLETED) succeeded++;
    else if (j.status === JobStatus.FAILED) failed++;
    else if (j.status === JobStatus.CANCELLED) cancelled++;

    if (j.finishReason) {
      finishReasons[j.finishReason] = (finishReasons[j.finishReason] ?? 0) + 1;
    }
    if (j.startedAt && j.completedAt) {
      durations.push((j.completedAt.getTime() - j.startedAt.getTime()) / 1000);
    }
    if (j.startedAt) {
      waits.push((j.startedAt.getTime() - j.queuedAt.getTime()) / 1000);
    }
    if (j.currentTurn > 0) {
      turnSum += j.currentTurn;
      turnCount++;
    }
    costTotal += j.costMicro;

    const e = (byEffort[j.effort] ??= { jobs: 0, credits: 0 });
    e.jobs++;
    e.credits += toCredits(j.costMicro);
  }

  durations.sort((a, b) => a - b);
  waits.sort((a, b) => a - b);
  const terminal = succeeded + failed + cancelled;

  const tools = await prisma.toolCall.groupBy({
    by: ["toolName", "status"],
    where: { createdAt: { gte: since } },
    _count: { _all: true },
  });

  const perTool = new Map<string, { calls: number; failures: number }>();
  for (const row of tools) {
    const entry = perTool.get(row.toolName) ?? { calls: 0, failures: 0 };
    entry.calls += row._count._all;
    if (row.status === ToolCallStatus.FAILED) entry.failures += row._count._all;
    perTool.set(row.toolName, entry);
  }
  const toolCalls = [...perTool.values()].reduce((n, t) => n + t.calls, 0);
  const toolFailures = [...perTool.values()].reduce((n, t) => n + t.failures, 0);

  // Provisioning is invisible in the tool table (it happens before the loop), so
  // read it off the finish reasons + error text instead. §2.3 made these silent;
  // surfacing them separately is the point.
  const provisionFailures = await prisma.job.count({
    where: {
      queuedAt: { gte: since },
      status: JobStatus.FAILED,
      error: { contains: "sandbox", mode: "insensitive" },
    },
  });

  return {
    window: label,
    jobs: jobs.length,
    succeeded,
    failed,
    cancelled,
    successRate: terminal > 0 ? round(succeeded / terminal) : null,
    finishReasons,
    p50DurationSeconds: round(percentile(durations, 0.5)),
    p95DurationSeconds: round(percentile(durations, 0.95)),
    p50QueueWaitSeconds: round(percentile(waits, 0.5)),
    p95QueueWaitSeconds: round(percentile(waits, 0.95)),
    avgTurns: turnCount > 0 ? round(turnSum / turnCount) : null,
    credits: toCredits(costTotal),
    creditsPerJob: jobs.length > 0 ? round(toCredits(costTotal) / jobs.length) : null,
    byEffort,
    toolCalls,
    toolFailures,
    toolFailureRate: toolCalls > 0 ? round(toolFailures / toolCalls) : null,
    topFailingTools: [...perTool.entries()]
      .filter(([, t]) => t.failures > 0)
      .sort((a, b) => b[1].failures - a[1].failures)
      .slice(0, 5)
      .map(([tool, t]) => ({ tool, ...t })),
    sandboxProvisionFailureRate:
      jobs.length > 0 ? round(provisionFailures / jobs.length) : null,
  };
}

function round(n: number | null): number | null {
  return n === null ? null : Math.round(n * 1000) / 1000;
}

// ── write operations ─────────────────────────────────────────────────────────

/**
 * Force-terminate a job, resident or not. The incident tool that exists because
 * §2 happened: `bus.requestCancel` alone is a no-op for a job whose owning
 * process is gone, which is precisely the kind that needs killing.
 */
export async function killJob(jobId: string): Promise<{ killed: boolean }> {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) throw Errors.notFound("Job not found");

  if (bus.isResident(jobId)) {
    // Let the runner tear it down cleanly — it settles and publishes for us.
    bus.requestCancel(jobId);
    return { killed: true };
  }

  const killed = await terminateStrandedJob(jobId, {
    status: JobStatus.FAILED,
    reason: FinishReason.ABANDONED,
    message: "This run was stopped by an administrator.",
  });
  return { killed };
}

export async function reconcileStuck() {
  return reapStaleJobs(false);
}

/** Free every concurrency slot a user is holding, settling stranded rows too. */
export async function releaseUserHolds(
  userId: string,
): Promise<{ released: number }> {
  const holds = await prisma.creditHold.findMany({
    where: { userId, status: HoldStatus.ACTIVE },
    select: { jobId: true },
  });

  for (const { jobId } of holds) {
    if (bus.isResident(jobId)) {
      bus.requestCancel(jobId);
      continue;
    }
    await terminateStrandedJob(jobId, {
      status: JobStatus.CANCELLED,
      reason: FinishReason.CANCELLED,
      message: "This run was stopped while freeing the account's job slots.",
    }).catch(() => {});
    await settle(jobId).catch(() => {});
  }
  return { released: holds.length };
}

// ── per-user / per-project views ─────────────────────────────────────────────

export async function getUserDetail(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, createdAt: true },
  });
  if (!user) throw Errors.notFound("User not found");

  const [billing, holds, jobs, projects, spend, gatewaySpend, apiKeys] =
    await Promise.all([
    prisma.billingAccount.findUnique({ where: { userId } }),
    prisma.creditHold.findMany({
      where: { userId, status: HoldStatus.ACTIVE },
      select: { jobId: true, amount: true, consumed: true, createdAt: true },
    }),
    prisma.job.findMany({
      where: { project: { userId } },
      orderBy: { queuedAt: "desc" },
      take: 25,
      select: {
        id: true,
        projectId: true,
        status: true,
        finishReason: true,
        effort: true,
        queuedAt: true,
        completedAt: true,
        costMicro: true,
        currentTurn: true,
      },
    }),
    prisma.project.count({ where: { userId } }),
    prisma.tokenUsage.groupBy({
      by: ["model"],
      where: { userId, recordedAt: { gte: new Date(Date.now() - 604_800_000) } },
      _sum: { inputTokens: true, outputTokens: true },
    }),
    // The runtime half. `TokenUsage` covers builds only, so without this a user
    // whose deployed app is burning credits looks idle here while their balance
    // drops — the exact support question this page exists to answer.
    prisma.gatewayUsage.groupBy({
      by: ["alias"],
      where: { userId, recordedAt: { gte: new Date(Date.now() - 604_800_000) } },
      _sum: { inputTokens: true, outputTokens: true, costMicro: true },
      _count: true,
    }),
    prisma.apiKey.findMany({
      where: { userId },
      select: {
        id: true,
        prefix: true,
        status: true,
        createdAt: true,
        lastUsedAt: true,
        revokeAfter: true,
        dailyCapMicro: true,
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return {
    user,
    projects,
    billing: billing
      ? {
          plan: billing.plan,
          // Three separate buckets, not one balance — a support question is
          // usually "which pot ran out", so don't collapse them.
          freeCredits: toCredits(billing.freeBalance),
          planCredits: toCredits(billing.planBalance),
          bonusCredits: toCredits(billing.bonusBalance),
          availableCredits: toCredits(
            billing.freeBalance + billing.planBalance + billing.bonusBalance,
          ),
          reservedCredits: toCredits(billing.reserved),
          cycleStart: billing.cycleStart,
          cycleEnd: billing.cycleEnd,
        }
      : null,
    activeHolds: holds.map((h) => ({
      jobId: h.jobId,
      amount: h.amount.toString(),
      consumed: h.consumed.toString(),
      createdAt: h.createdAt,
      resident: bus.isResident(h.jobId),
    })),
    recentJobs: jobs.map((j) => ({
      ...j,
      costMicro: j.costMicro.toString(),
      credits: toCredits(j.costMicro),
    })),
    spend7dByModel: spend.map((s) => ({
      model: s.model,
      inputTokens: s._sum.inputTokens ?? 0,
      outputTokens: s._sum.outputTokens ?? 0,
    })),
    gatewaySpend7dByAlias: gatewaySpend.map((s) => ({
      alias: s.alias,
      requests: s._count,
      inputTokens: s._sum.inputTokens ?? 0,
      outputTokens: s._sum.outputTokens ?? 0,
      credits: toCredits(s._sum.costMicro ?? 0n),
    })),
    // Never the key itself and never the ciphertext — an operator browsing user
    // data is already a privacy question (ADMIN_ALLOW_CONTENT), and a
    // decryptable spend credential would be strictly worse. Prefix and status
    // are enough to answer "is their key working" and "should we revoke it".
    apiKeys: apiKeys.map((k) => ({
      id: k.id,
      prefix: k.prefix,
      status: k.status,
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt,
      revokeAfter: k.revokeAfter,
      dailyCapCredits:
        k.dailyCapMicro === null ? null : toCredits(k.dailyCapMicro),
    })),
  };
}

/**
 * Gateway traffic across every key, newest window first.
 *
 * The abuse-triage view: `GatewayUsage` is the only place runtime inference is
 * recorded, and until this existed the only way to ask "who is hammering the
 * gateway" was a hand-written query. Ordered by spend rather than request count
 * — a thousand `tau-fast` calls matter less than fifty `tau-max` ones.
 */
export async function getGatewayOverview(opts: { hours?: number } = {}) {
  const hours = Math.min(Math.max(opts.hours ?? 24, 1), 24 * 30);
  const since = new Date(Date.now() - hours * 3_600_000);

  const [byKey, byAlias, totals] = await Promise.all([
    prisma.gatewayUsage.groupBy({
      by: ["apiKeyId", "userId"],
      where: { recordedAt: { gte: since } },
      _sum: { costMicro: true, inputTokens: true, outputTokens: true },
      _count: true,
    }),
    prisma.gatewayUsage.groupBy({
      by: ["alias"],
      where: { recordedAt: { gte: since } },
      _sum: { costMicro: true },
      _count: true,
    }),
    prisma.gatewayUsage.aggregate({
      where: { recordedAt: { gte: since } },
      _sum: { costMicro: true },
      _count: true,
    }),
  ]);

  const keys = await prisma.apiKey.findMany({
    where: { id: { in: byKey.map((k) => k.apiKeyId) } },
    select: { id: true, prefix: true, status: true },
  });
  const keyById = new Map(keys.map((k) => [k.id, k]));

  return {
    windowHours: hours,
    since,
    totals: {
      requests: totals._count,
      credits: toCredits(totals._sum.costMicro ?? 0n),
    },
    byAlias: byAlias.map((a) => ({
      alias: a.alias,
      requests: a._count,
      credits: toCredits(a._sum.costMicro ?? 0n),
    })),
    topKeys: byKey
      .map((k) => ({
        apiKeyId: k.apiKeyId,
        userId: k.userId,
        // Prefix only. An operator needs to identify a key to revoke it, not to
        // use it.
        prefix: keyById.get(k.apiKeyId)?.prefix ?? null,
        status: keyById.get(k.apiKeyId)?.status ?? null,
        requests: k._count,
        credits: toCredits(k._sum.costMicro ?? 0n),
        inputTokens: k._sum.inputTokens ?? 0,
        outputTokens: k._sum.outputTokens ?? 0,
      }))
      .sort((a, b) => b.credits - a.credits)
      .slice(0, 50),
  };
}

export async function getProjectDetail(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      userId: true,
      createdAt: true,
      updatedAt: true,
      templateKey: true,
      sandboxId: true,
      sandboxStatus: true,
      sandboxExpiresAt: true,
      githubRepo: true,
    },
  });
  if (!project) throw Errors.notFound("Project not found");

  const [fileCount, jobs, checkpoints, messageCount] = await Promise.all([
    prisma.projectFile.count({ where: { projectId } }),
    prisma.job.findMany({
      where: { projectId },
      orderBy: { queuedAt: "desc" },
      take: 25,
      select: {
        id: true,
        status: true,
        finishReason: true,
        effort: true,
        queuedAt: true,
        completedAt: true,
        currentTurn: true,
        costMicro: true,
      },
    }),
    prisma.contextCheckpoint.findMany({
      where: { projectId },
      orderBy: { upToSequence: "asc" },
      select: {
        upToSequence: true,
        tokensBefore: true,
        tokensAfter: true,
        createdAt: true,
      },
    }),
    prisma.message.count({ where: { projectId } }),
  ]);

  return {
    project,
    fileCount,
    messageCount,
    checkpoints,
    jobs: jobs.map((j) => ({
      ...j,
      costMicro: j.costMicro.toString(),
      credits: toCredits(j.costMicro),
    })),
  };
}

// ── sandbox inventory ────────────────────────────────────────────────────────

/**
 * Reconcile `Project.sandboxId`/`sandboxStatus` against reality.
 *
 * Sandbox leaks are OVERVIEW #4 — a known-but-unmeasured problem. This makes it
 * countable: how many projects claim a READY sandbox, and how many of those
 * claims are stale (the row says READY but the E2B sandbox is gone, or its
 * recorded expiry has passed). `check` actually probes E2B, which costs a
 * round-trip per sandbox, so it is opt-in.
 */
export async function getSandboxInventory(check = false) {
  const projects = await prisma.project.findMany({
    where: { sandboxId: { not: null } },
    select: {
      id: true,
      name: true,
      userId: true,
      sandboxId: true,
      sandboxStatus: true,
      sandboxExpiresAt: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });

  const now = Date.now();
  const rows = projects.map((p) => ({
    ...p,
    expired: p.sandboxExpiresAt ? p.sandboxExpiresAt.getTime() < now : null,
    // A READY row nobody has touched in hours, with no live job, is the shape a
    // leak takes: the sandbox is probably still billing with nothing using it.
    suspectedLeak:
      p.sandboxStatus === SandboxStatus.READY &&
      now - p.updatedAt.getTime() > 6 * 3_600_000,
    alive: null as boolean | null,
  }));

  if (check) {
    const { Sandbox } = await import("e2b");
    await Promise.all(
      rows.map(async (row) => {
        if (!row.sandboxId) return;
        try {
          const sbx = await Sandbox.connect(row.sandboxId);
          await sbx.commands.run("true", { timeoutMs: 5000 });
          row.alive = true;
        } catch {
          row.alive = false;
        }
      }),
    );
  }

  return {
    total: rows.length,
    ready: rows.filter((r) => r.sandboxStatus === SandboxStatus.READY).length,
    suspectedLeaks: rows.filter((r) => r.suspectedLeak).length,
    ...(check ? { confirmedDead: rows.filter((r) => r.alive === false).length } : {}),
    sandboxes: rows,
  };
}
