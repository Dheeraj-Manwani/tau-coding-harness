import { Sandbox } from "e2b";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { bus } from "@/lib/bus";
import { isDraining } from "@/lib/lifecycle";
import { toCredits } from "@/lib/pricing";
import { errorSummary, httpSummary, processStats } from "@/lib/telemetry";
import { JobStatus, SandboxStatus, SubscriptionStatus } from "@/generated/prisma/enums";
import { Errors } from "../lib/errors";
import { log } from "../lib/log";
import { memo } from "../lib/memo";
import { countStaleWebhooks } from "../lib/alerts";
import {
  deepseekBalance,
  e2bSandboxes,
  kimiBalance,
  tavilyUsage,
  type LiveSandbox,
} from "../lib/providers";
import {
  deepseekAnomalies,
  httpAnomalies,
  jobAnomalies,
  kimiAnomalies,
  runtimeAnomalies,
  sandboxAnomalies,
  sortAnomalies,
  surfaceAnomalies,
  tavilyAnomalies,
  type SandboxReconciliation,
} from "../lib/anomalies";
import { getHealth, getMetrics } from "./admin.service";

/**
 * The ops console's read model.
 *
 * The console's contract is "reload is the refresh button" — no polling — so
 * this is built to make a reload cheap rather than to be called often:
 *
 *   - ONE aggregate per page load instead of a request per widget: one auth
 *     lookup, one cache key, one consistent snapshot;
 *   - cached 30 s and shared by every tab, with concurrent callers sharing one
 *     computation (`memo`). A forced refresh is honoured at most every 10 s;
 *   - provider checks are cached 5 min on their own (see providers.ts).
 *
 * Worst case, while someone is looking: ~20 aggregate queries per 30 s.
 */

const OVERVIEW_TTL_MS = 30_000;
const H1 = 3_600_000;
const D1 = 86_400_000;
const D7 = 7 * D1;

/**
 * A sandbox younger than this with no project pointing at it is probably still
 * provisioning: `Project.sandboxId` is written only after rehydration, which
 * can take minutes. Comfortably above that, and above E2B's own idle timeout.
 */
export const ORPHAN_MIN_AGE_MS = 15 * 60_000;

/** Turn `groupBy` rows into `{ [key]: count }`. */
function countsBy<K extends string>(
  rows: Array<{ _count: { _all: number } } & Record<string, unknown>>,
  key: K,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) out[String(row[key])] = row._count._all;
  return out;
}

// ── sandboxes ────────────────────────────────────────────────────────────────

export interface LiveSandboxRow extends LiveSandbox {
  ageMinutes: number;
  project: {
    id: string;
    name: string;
    userId: string;
    email: string;
    sandboxStatus: SandboxStatus;
    updatedAt: Date;
  } | null;
  residentJobId: string | null;
  /** Running in E2B, owned by nothing, old enough not to be mid-provision. */
  orphan: boolean;
}

/**
 * E2B's view of what is running, joined to ours.
 *
 * E2B is the source of truth for what is *billing*; `Project.sandboxId` only for
 * what we think we own. The two disagree in exactly two interesting ways:
 *   - **orphan**: running in E2B, referenced by no project and no live job —
 *     usually a sandbox replaced by a reprovision and never killed;
 *   - **stale row**: a project says READY but E2B has no such sandbox — harmless
 *     (it reprovisions on next use) but it skews every "how many are live" count.
 */
export async function getLiveSandboxes(fresh = false) {
  const live = await e2bSandboxes(fresh);
  if (live.status !== "ok") {
    return {
      status: live.status,
      error: live.status === "error" ? live.error : undefined,
      fetchedAt: live.fetchedAt,
      truncated: false,
      total: 0,
      running: 0,
      paused: 0,
      orphans: 0,
      staleDbRows: 0,
      sandboxes: [] as LiveSandboxRow[],
      stale: [] as Array<{ projectId: string; name: string; sandboxId: string | null; updatedAt: Date }>,
    };
  }

  const ids = live.data.map((s) => s.sandboxId);
  const [owners, readyRows] = await Promise.all([
    prisma.project.findMany({
      where: { sandboxId: { in: ids } },
      select: {
        id: true,
        name: true,
        userId: true,
        sandboxId: true,
        sandboxStatus: true,
        updatedAt: true,
        user: { select: { email: true } },
      },
    }),
    prisma.project.findMany({
      where: { sandboxStatus: SandboxStatus.READY, sandboxId: { not: null } },
      select: { id: true, name: true, sandboxId: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: 1_000,
    }),
  ]);

  const ownerBySandbox = new Map(owners.map((p) => [p.sandboxId!, p]));
  const residentBySandbox = new Map(
    bus
      .registrySnapshot()
      .filter((e) => e.sandboxId)
      .map((e) => [e.sandboxId!, e.jobId]),
  );

  const now = Date.now();
  const rows: LiveSandboxRow[] = live.data.map((s) => {
    const owner = ownerBySandbox.get(s.sandboxId);
    const residentJobId = residentBySandbox.get(s.sandboxId) ?? null;
    const ageMs = now - new Date(s.startedAt).getTime();
    return {
      ...s,
      ageMinutes: Math.round(ageMs / 60_000),
      project: owner
        ? {
            id: owner.id,
            name: owner.name,
            userId: owner.userId,
            email: owner.user.email,
            sandboxStatus: owner.sandboxStatus,
            updatedAt: owner.updatedAt,
          }
        : null,
      residentJobId,
      orphan: !owner && !residentJobId && ageMs >= ORPHAN_MIN_AGE_MS,
    };
  });

  // Only trust "absent from E2B" when the list was complete.
  const truncated = live.data.length >= 500;
  const liveIds = new Set(ids);
  const stale = truncated
    ? []
    : readyRows
        .filter((p) => p.sandboxId && !liveIds.has(p.sandboxId))
        .map((p) => ({ projectId: p.id, name: p.name, sandboxId: p.sandboxId, updatedAt: p.updatedAt }));

  rows.sort((a, b) => Number(b.orphan) - Number(a.orphan) || b.ageMinutes - a.ageMinutes);

  return {
    status: "ok" as const,
    error: undefined,
    fetchedAt: live.fetchedAt,
    truncated,
    total: rows.length,
    running: rows.filter((r) => r.state === "running").length,
    paused: rows.filter((r) => r.state === "paused").length,
    // Paused sandboxes don't bill compute, so only running orphans are a leak.
    orphans: rows.filter((r) => r.orphan && r.state === "running").length,
    staleDbRows: stale.length,
    sandboxes: rows,
    stale,
  };
}

/**
 * Kill an orphan sandbox — and only an orphan.
 *
 * A sandbox a project points at is that user's live preview; one a running job
 * holds is mid-build. Killing either would break someone's session, so both
 * are refused outright rather than left to an operator's judgement at 3 a.m.
 * The age floor covers the window where a fresh sandbox is still provisioning
 * and simply hasn't been written to its project yet.
 */
export async function killOrphanSandbox(sandboxId: string) {
  const resident = bus.registrySnapshot().find((e) => e.sandboxId === sandboxId);
  if (resident) {
    throw Errors.conflict(`Sandbox is in use by running job ${resident.jobId}`);
  }

  const owner = await prisma.project.findFirst({
    where: { sandboxId },
    select: { id: true },
  });
  if (owner) {
    throw Errors.conflict(
      `Sandbox belongs to project ${owner.id} — it is that user's live preview, not an orphan`,
    );
  }

  let startedAt: Date;
  try {
    ({ startedAt } = await Sandbox.getInfo(sandboxId, { apiKey: env.E2B_API_KEY }));
  } catch {
    throw Errors.notFound("Sandbox not found in E2B");
  }
  if (Date.now() - startedAt.getTime() < ORPHAN_MIN_AGE_MS) {
    throw Errors.conflict("Sandbox is under 15 minutes old — it may still be provisioning");
  }

  const killed = await Sandbox.kill(sandboxId, { apiKey: env.E2B_API_KEY });
  log.info("admin.sandbox.kill", { sandboxId, killed });
  // The cached list now contains a sandbox that no longer exists; refetch it
  // so the console's next reload doesn't show it as still running.
  void e2bSandboxes(true);
  return { killed };
}

async function sandboxReconciliation(fresh: boolean): Promise<SandboxReconciliation & {
  running: number;
  paused: number;
}> {
  const s = await getLiveSandboxes(fresh);
  return {
    status: s.status,
    error: s.error,
    orphans: s.orphans,
    staleDbRows: s.staleDbRows,
    running: s.running,
    paused: s.paused,
  };
}

// ── database snapshot ────────────────────────────────────────────────────────

async function dbSnapshot() {
  const now = Date.now();
  const h1 = new Date(now - H1);
  const d1 = new Date(now - D1);
  const d7 = new Date(now - D7);

  const [
    usersTotal,
    signups24h,
    signups7d,
    builders,
    plans,
    subscriptions,
    projectsTotal,
    projects24h,
    liveSites,
    deploys,
    attachments,
    feedback,
    webhookBacklog,
    webhooks24h,
    ledger,
    promoRedemptions7d,
    gateway,
    recentFailures,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: d1 } } }),
    prisma.user.count({ where: { createdAt: { gte: d7 } } }),
    prisma.$queryRaw<{ d1: bigint; d7: bigint }[]>`
      SELECT COUNT(DISTINCT p."userId") FILTER (WHERE j."queuedAt" >= ${d1}) AS d1,
             COUNT(DISTINCT p."userId") AS d7
      FROM "Job" j JOIN "Project" p ON p.id = j."projectId"
      WHERE j."queuedAt" >= ${d7}
    `,
    prisma.billingAccount.groupBy({ by: ["plan"], _count: { _all: true } }),
    prisma.subscription.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.project.count(),
    prisma.project.count({ where: { createdAt: { gte: d1 } } }),
    prisma.project.count({ where: { liveDeploymentId: { not: null } } }),
    prisma.deployment.groupBy({
      by: ["status"],
      where: { createdAt: { gte: d1 } },
      _count: { _all: true },
    }),
    prisma.attachment.groupBy({
      by: ["status"],
      where: { createdAt: { gte: d1 } },
      _count: { _all: true },
    }),
    prisma.feedback.aggregate({
      where: { createdAt: { gte: d7 } },
      _count: { _all: true },
      _avg: { rating: true },
    }),
    countStaleWebhooks(),
    prisma.webhookEvent.count({ where: { createdAt: { gte: d1 } } }),
    prisma.creditLedger.groupBy({
      by: ["type"],
      where: { createdAt: { gte: d1 } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.promoRedemption.count({ where: { createdAt: { gte: d7 } } }),
    // Upstream status ≥ 400 is the gateway failing a deployed app's AI call —
    // invisible to the app's owner until their users complain.
    prisma.$queryRaw<
      { req1: bigint; err1: bigint; cost1: bigint; req24: bigint; err24: bigint; cost24: bigint }[]
    >`
      SELECT COUNT(*) FILTER (WHERE "recordedAt" >= ${h1}) AS req1,
             COUNT(*) FILTER (WHERE "recordedAt" >= ${h1} AND status >= 400) AS err1,
             COALESCE(SUM("costMicro") FILTER (WHERE "recordedAt" >= ${h1}), 0)::bigint AS cost1,
             COUNT(*) AS req24,
             COUNT(*) FILTER (WHERE status >= 400) AS err24,
             COALESCE(SUM("costMicro"), 0)::bigint AS cost24
      FROM "GatewayUsage"
      WHERE "recordedAt" >= ${d1}
    `,
    prisma.job.findMany({
      where: { status: JobStatus.FAILED, queuedAt: { gte: d1 } },
      orderBy: { queuedAt: "desc" },
      take: 15,
      select: {
        id: true,
        projectId: true,
        type: true,
        effort: true,
        finishReason: true,
        // Our own text, never the user's — see listJobs.
        error: true,
        queuedAt: true,
        completedAt: true,
        project: { select: { userId: true } },
      },
    }),
  ]);

  const g = gateway[0];
  const subsByStatus = countsBy(subscriptions, "status");

  return {
    users: {
      total: usersTotal,
      signups24h,
      signups7d,
      activeBuilders24h: Number(builders[0]?.d1 ?? 0),
      activeBuilders7d: Number(builders[0]?.d7 ?? 0),
    },
    business: {
      plans: countsBy(plans, "plan"),
      subscriptions: subsByStatus,
      // Signed: grants positive, spend negative — exactly as the ledger has it.
      credits24h: Object.fromEntries(
        ledger.map((l) => [
          l.type,
          { entries: l._count._all, credits: toCredits(l._sum.amount ?? 0n) },
        ]),
      ),
      promoRedemptions7d,
    },
    projects: { total: projectsTotal, created24h: projects24h, liveSites },
    deploys24h: countsBy(deploys, "status"),
    attachments24h: countsBy(attachments, "status"),
    feedback7d: {
      count: feedback._count._all,
      avgRating: feedback._avg.rating === null ? null : Math.round(feedback._avg.rating * 100) / 100,
    },
    webhooks: { backlog: webhookBacklog, received24h: webhooks24h },
    gateway: {
      h1: { requests: Number(g?.req1 ?? 0), errors: Number(g?.err1 ?? 0), credits: toCredits(g?.cost1 ?? 0n) },
      h24: { requests: Number(g?.req24 ?? 0), errors: Number(g?.err24 ?? 0), credits: toCredits(g?.cost24 ?? 0n) },
    },
    recentFailures: recentFailures.map(({ project, ...j }) => ({ ...j, userId: project.userId })),
    haltedSubscriptions: subsByStatus[SubscriptionStatus.HALTED] ?? 0,
  };
}

// ── overview ─────────────────────────────────────────────────────────────────

async function computeOverview(fresh: boolean) {
  const [health, metrics, proc, deepseek, kimi, tavily, sandboxes, db] = await Promise.all([
    getHealth(),
    getMetrics(),
    processStats(),
    deepseekBalance(fresh),
    kimiBalance(fresh),
    tavilyUsage(fresh),
    sandboxReconciliation(fresh),
    dbSnapshot(),
  ]);

  const http = httpSummary(60);
  const http15m = httpSummary(15);
  const errors = errorSummary({ groups: 10, recent: 0 });
  const draining = isDraining();

  const anomalies = sortAnomalies([
    ...jobAnomalies(health, metrics),
    ...deepseekAnomalies(deepseek, env.DEEPSEEK_LOW_BALANCE),
    ...kimiAnomalies(kimi),
    ...tavilyAnomalies(tavily),
    ...sandboxAnomalies(sandboxes),
    ...runtimeAnomalies(proc, draining),
    ...httpAnomalies(http15m, errors.last15m),
    ...surfaceAnomalies({
      gateway1h: db.gateway.h1,
      deploys24h: db.deploys24h,
      attachments24h: db.attachments24h,
      webhookBacklog: db.webhooks.backlog,
      haltedSubscriptions: db.haltedSubscriptions,
    }),
  ]);

  const { haltedSubscriptions: _halted, recentFailures, ...rest } = db;

  return {
    anomalies,
    runtime: { health, process: proc, draining },
    providers: {
      deepseek,
      deepseekLowBalance: env.DEEPSEEK_LOW_BALANCE,
      kimi,
      tavily,
      e2b: sandboxes,
    },
    http,
    errors: { last15m: errors.last15m, last60m: errors.last60m, topGroups: errors.groups },
    jobs: { metrics, recentFailures },
    ...rest,
  };
}

export type Overview = Awaited<ReturnType<typeof computeOverview>> & {
  generatedAt: string;
  cacheAgeSeconds: number;
};

export async function getOverview(fresh = false): Promise<Overview> {
  const { value, at } = await memo("admin:overview", () => computeOverview(fresh), {
    ttlMs: OVERVIEW_TTL_MS,
    fresh,
  });
  return {
    ...value,
    generatedAt: new Date(at).toISOString(),
    cacheAgeSeconds: Math.round((Date.now() - at) / 1000),
  };
}

// ── errors ───────────────────────────────────────────────────────────────────

export function getErrors() {
  return errorSummary();
}

// ── user search ──────────────────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Find accounts by email fragment or exact id — the first step of every
 * support question. Empty query lists the newest sign-ups.
 */
export async function searchUsers(q: string | undefined) {
  const query = (q ?? "").trim().slice(0, 200);
  const where = !query
    ? {}
    : UUID.test(query)
      ? { OR: [{ id: query }, { email: { contains: query, mode: "insensitive" as const } }] }
      : { email: { contains: query, mode: "insensitive" as const } };

  const users = await prisma.user.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      email: true,
      displayName: true,
      role: true,
      createdAt: true,
      emailVerifiedAt: true,
      billing: { select: { plan: true, freeBalance: true, planBalance: true, bonusBalance: true } },
      _count: { select: { projects: true } },
    },
  });

  return users.map(({ billing, _count, ...u }) => ({
    ...u,
    plan: billing?.plan ?? null,
    availableCredits: billing
      ? toCredits(billing.freeBalance + billing.planBalance + billing.bonusBalance)
      : 0,
    projects: _count.projects,
  }));
}
