import type { AdminHealth, WindowMetrics } from "../services/admin.service";
import type { Check, DeepseekBalance, KimiBalance, TavilyUsage } from "./providers";
import type { HttpSummary, ProcessStats } from "@/lib/telemetry";

/**
 * Every rule that decides "this needs a human", in one pure module.
 *
 * Two consumers read it: the hourly alert sweep (`alerts.ts`, which pages) and
 * the ops console's anomaly list (which also shows `info`). Keeping the rules
 * here — rather than one copy in each — is what guarantees the console and the
 * pager never disagree about what is wrong.
 *
 * Every rule fires on a **count or a rate**, never per row, and rates need a
 * minimum sample. An alert that fires a thousand times is an alert nobody reads.
 *
 * Only type imports: this module must stay loadable without an environment so
 * every threshold can be unit-tested at, below and above its edge.
 */

export type Severity = "info" | "warn" | "critical";

export interface Anomaly {
  key: string;
  severity: Severity;
  message: string;
  value: number;
}

/** Rates below this sample size are noise, not signal. */
export const MIN_SAMPLE = 20;

export const THRESHOLDS = {
  jobFailureRate: 0.1,
  sandboxProvisionFailureRate: 0.05,
  toolFailureRate: 0.1,
  p95DurationSeconds: 900,
  costPerJobMultiplier: 2,

  kimiLowBalance: 2,
  tavilyPlanUsageRatio: 0.9,

  eventLoopWarnMs: 500,
  eventLoopCriticalMs: 2_000,
  memoryRatio: 0.85,
  /** When the container has no cgroup limit to compare against. */
  memoryFallbackMB: 1_536,
  diskFreeRatio: 0.1,

  http5xxRate: 0.02,
  http5xxMinRequests: 50,
  errorSpike15m: 20,

  gatewayErrorRate: 0.1,
  gatewayMinRequests: 20,
  deployFailureRate: 0.3,
  deployMinSample: 5,
  attachmentFailureRate: 0.2,
  attachmentMinSample: 10,
} as const;

const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;

// ── jobs (the original alert set) ────────────────────────────────────────────

export function jobAnomalies(
  health: Pick<AdminHealth, "stuckJobs" | "orphanHolds">,
  metrics: WindowMetrics[],
): Anomaly[] {
  const out: Anomaly[] = [];

  // The alarm that would have caught the original stuck-job bug.
  if (health.stuckJobs > 0) {
    out.push({
      key: "stuck_jobs",
      severity: "critical",
      value: health.stuckJobs,
      message: `${health.stuckJobs} job(s) non-terminal with a cold heartbeat — their projects are refusing new prompts`,
    });
  }

  // Leaked concurrency: holds outliving the job they were taken for.
  if (health.orphanHolds > 0) {
    out.push({
      key: "orphan_holds",
      severity: "warn",
      value: health.orphanHolds,
      message: `${health.orphanHolds} ACTIVE credit hold(s) behind a terminal job — concurrency slots leaked`,
    });
  }

  const hour = metrics.find((m) => m.window === "1h");
  if (!hour || hour.jobs < MIN_SAMPLE) return out;

  const failureRate = hour.successRate === null ? null : 1 - hour.successRate;
  if (failureRate !== null && failureRate > THRESHOLDS.jobFailureRate) {
    out.push({
      key: "job_failure_rate",
      severity: "critical",
      value: failureRate,
      message: `${pct(failureRate)} of jobs failed in the last hour (${hour.failed}/${hour.jobs})`,
    });
  }

  // Provisioning separately: a blended rate would hide it behind agent errors.
  if (
    hour.sandboxProvisionFailureRate !== null &&
    hour.sandboxProvisionFailureRate > THRESHOLDS.sandboxProvisionFailureRate
  ) {
    out.push({
      key: "sandbox_provision_failure_rate",
      severity: "critical",
      value: hour.sandboxProvisionFailureRate,
      message: `${pct(hour.sandboxProvisionFailureRate)} of jobs failed with a sandbox error in the last hour`,
    });
  }

  // Per-tool: the early warning for a broken template or sandbox change.
  if (
    hour.toolFailureRate !== null &&
    hour.toolCalls >= MIN_SAMPLE &&
    hour.toolFailureRate > THRESHOLDS.toolFailureRate
  ) {
    const worst = hour.topFailingTools.map((t) => `${t.tool} ${t.failures}/${t.calls}`).join(", ");
    out.push({
      key: "tool_failure_rate",
      severity: "warn",
      value: hour.toolFailureRate,
      message: `tool failure rate ${pct(hour.toolFailureRate)} in the last hour — ${worst}`,
    });
  }

  if (hour.p95DurationSeconds !== null && hour.p95DurationSeconds > THRESHOLDS.p95DurationSeconds) {
    out.push({
      key: "p95_duration",
      severity: "warn",
      value: hour.p95DurationSeconds,
      message: `p95 job duration ${Math.round(hour.p95DurationSeconds / 60)}m in the last hour`,
    });
  }

  const day = metrics.find((m) => m.window === "24h");
  if (
    hour.creditsPerJob !== null &&
    day?.creditsPerJob != null &&
    day.creditsPerJob > 0 &&
    hour.creditsPerJob > day.creditsPerJob * THRESHOLDS.costPerJobMultiplier
  ) {
    out.push({
      key: "cost_per_job",
      severity: "warn",
      value: hour.creditsPerJob,
      message: `credits/job ${hour.creditsPerJob.toFixed(2)} this hour vs ${day.creditsPerJob.toFixed(2)} over 24h`,
    });
  }

  return out;
}

// ── providers ────────────────────────────────────────────────────────────────

/** The balance that answers "are we about to run out": the largest one. */
export function primaryBalance(b: DeepseekBalance): { currency: string; total: number } | null {
  if (b.balances.length === 0) return null;
  return b.balances.reduce((best, cur) => (cur.total > best.total ? cur : best));
}

function checkFailed(provider: string, c: Check<unknown> | undefined): Anomaly[] {
  if (c?.status !== "error") return [];
  return [
    {
      key: `provider_check_failed:${provider}`,
      severity: "warn",
      value: 1,
      message: `could not read ${provider} account status — ${c.error}`,
    },
  ];
}

/** Every build stops when this hits zero, so both rules are critical. */
export function deepseekAnomalies(
  c: Check<DeepseekBalance> | undefined,
  lowBalance: number,
): Anomaly[] {
  if (!c || c.status === "unconfigured") return [];
  if (c.status === "error") return checkFailed("deepseek", c);

  if (!c.data.available) {
    return [
      {
        key: "deepseek_unavailable",
        severity: "critical",
        value: 0,
        message: "DeepSeek reports the account cannot serve requests (is_available=false) — builds will fail",
      },
    ];
  }
  const primary = primaryBalance(c.data);
  if (primary && primary.total < lowBalance) {
    return [
      {
        key: "deepseek_low",
        severity: "critical",
        value: primary.total,
        message: `DeepSeek balance ${primary.total.toFixed(2)} ${primary.currency} is below ${lowBalance} — top up before builds start failing`,
      },
    ];
  }
  return [];
}

export function kimiAnomalies(c: Check<KimiBalance> | undefined): Anomaly[] {
  if (!c || c.status === "unconfigured") return [];
  if (c.status === "error") return checkFailed("kimi", c);
  if (c.data.available >= THRESHOLDS.kimiLowBalance) return [];
  return [
    {
      key: "kimi_low",
      severity: "warn",
      value: c.data.available,
      message: `Kimi balance ${c.data.available.toFixed(2)} ${c.data.currency} — attachment extraction will start failing`,
    },
  ];
}

export function tavilyAnomalies(c: Check<TavilyUsage> | undefined): Anomaly[] {
  if (!c || c.status === "unconfigured") return [];
  if (c.status === "error") return checkFailed("tavily", c);
  const { planUsage, planLimit } = c.data;
  if (planUsage === null || !planLimit) return [];
  const ratio = planUsage / planLimit;
  if (ratio <= THRESHOLDS.tavilyPlanUsageRatio) return [];
  return [
    {
      key: "tavily_quota",
      severity: "warn",
      value: ratio,
      message: `Tavily plan ${pct(ratio)} used (${planUsage}/${planLimit}) — the agent's web search stops at the limit`,
    },
  ];
}

export interface SandboxReconciliation {
  status: "ok" | "error" | "unconfigured";
  error?: string;
  orphans: number;
  staleDbRows: number;
}

export function sandboxAnomalies(s: SandboxReconciliation | undefined): Anomaly[] {
  if (!s || s.status === "unconfigured") return [];
  if (s.status === "error") {
    return [
      {
        key: "provider_check_failed:e2b",
        severity: "warn",
        value: 1,
        message: `could not list E2B sandboxes — ${s.error ?? "unknown error"}`,
      },
    ];
  }
  const out: Anomaly[] = [];
  if (s.orphans > 0) {
    out.push({
      key: "e2b_orphans",
      severity: "warn",
      value: s.orphans,
      message: `${s.orphans} E2B sandbox(es) running that no project points at — billing for nothing`,
    });
  }
  if (s.staleDbRows > 0) {
    out.push({
      key: "e2b_stale_rows",
      severity: "info",
      value: s.staleDbRows,
      message: `${s.staleDbRows} project(s) marked READY whose sandbox no longer exists — they'll reprovision on next use`,
    });
  }
  return out;
}

// ── runtime ──────────────────────────────────────────────────────────────────

export function runtimeAnomalies(p: ProcessStats | undefined, draining = false): Anomaly[] {
  const out: Anomaly[] = [];
  if (draining) {
    out.push({
      key: "draining",
      severity: "warn",
      value: 1,
      message: "process is draining after SIGTERM — new prompts are being refused",
    });
  }
  if (!p) return out;

  const lag = p.eventLoop.maxMs1m;
  if (lag > THRESHOLDS.eventLoopWarnMs) {
    out.push({
      key: "event_loop_lag",
      severity: lag > THRESHOLDS.eventLoopCriticalMs ? "critical" : "warn",
      value: lag,
      message: `event loop blocked up to ${Math.round(lag)}ms in the last minute — every request and stream waited`,
    });
  }

  const limit = p.container.limitMB;
  const used = p.container.usedMB ?? p.memory.rssMB;
  if (limit ? used / limit > THRESHOLDS.memoryRatio : p.memory.rssMB > THRESHOLDS.memoryFallbackMB) {
    out.push({
      key: "memory_pressure",
      severity: "warn",
      value: used,
      message: limit
        ? `memory ${used}MB of ${limit}MB container limit (${pct(used / limit)})`
        : `RSS ${p.memory.rssMB}MB with no container limit to bound it`,
    });
  }

  if (p.disk && p.disk.totalGB > 0 && p.disk.freeGB / p.disk.totalGB < THRESHOLDS.diskFreeRatio) {
    out.push({
      key: "disk_low",
      severity: "warn",
      value: p.disk.freeGB,
      message: `disk ${p.disk.freeGB}GB free of ${p.disk.totalGB}GB — check docker log rotation and old images`,
    });
  }
  return out;
}

export function httpAnomalies(
  http15m: Pick<HttpSummary, "requests" | "byClass" | "rate5xx"> | undefined,
  errors15m: { errors: number } | undefined,
): Anomaly[] {
  const out: Anomaly[] = [];
  if (
    http15m &&
    http15m.requests >= THRESHOLDS.http5xxMinRequests &&
    http15m.rate5xx !== null &&
    http15m.rate5xx > THRESHOLDS.http5xxRate
  ) {
    out.push({
      key: "http_5xx_rate",
      severity: "warn",
      value: http15m.rate5xx,
      message: `${pct(http15m.rate5xx)} of requests returned 5xx in the last 15 min (${http15m.byClass["5xx"]}/${http15m.requests})`,
    });
  }
  if (errors15m && errors15m.errors > THRESHOLDS.errorSpike15m) {
    out.push({
      key: "error_spike",
      severity: "warn",
      value: errors15m.errors,
      message: `${errors15m.errors} errors logged in the last 15 min`,
    });
  }
  return out;
}

// ── product surfaces ─────────────────────────────────────────────────────────

export interface SurfaceSignals {
  gateway1h?: { requests: number; errors: number };
  /** DeploymentStatus → count, last 24h. */
  deploys24h?: Record<string, number>;
  /** AttachmentStatus → count, last 24h. */
  attachments24h?: Record<string, number>;
  webhookBacklog?: number;
  haltedSubscriptions?: number;
}

/** Unprocessed payment webhooks are money in limbo — a paid user without credits. */
export function webhookAnomalies(backlog: number | undefined): Anomaly[] {
  if (!backlog) return [];
  return [
    {
      key: "webhook_backlog",
      severity: "critical",
      value: backlog,
      message: `${backlog} Razorpay webhook event(s) unprocessed for over 10 min — a payment may not have been credited`,
    },
  ];
}

export function surfaceAnomalies(s: SurfaceSignals): Anomaly[] {
  const out: Anomaly[] = [...webhookAnomalies(s.webhookBacklog)];

  const g = s.gateway1h;
  if (g && g.requests >= THRESHOLDS.gatewayMinRequests && g.errors / g.requests > THRESHOLDS.gatewayErrorRate) {
    out.push({
      key: "gateway_upstream_errors",
      severity: "warn",
      value: g.errors / g.requests,
      message: `${pct(g.errors / g.requests)} of AI gateway calls failed upstream in the last hour (${g.errors}/${g.requests}) — deployed apps' AI features are broken`,
    });
  }

  if (s.deploys24h) {
    const failed = s.deploys24h["FAILED"] ?? 0;
    const finished = failed + (s.deploys24h["READY"] ?? 0) + (s.deploys24h["SUPERSEDED"] ?? 0);
    if (finished >= THRESHOLDS.deployMinSample && failed / finished > THRESHOLDS.deployFailureRate) {
      out.push({
        key: "deploy_failures",
        severity: "warn",
        value: failed / finished,
        message: `${pct(failed / finished)} of publishes failed in 24h (${failed}/${finished})`,
      });
    }
  }

  if (s.attachments24h) {
    const failed = s.attachments24h["FAILED"] ?? 0;
    const finished = failed + (s.attachments24h["READY"] ?? 0);
    if (finished >= THRESHOLDS.attachmentMinSample && failed / finished > THRESHOLDS.attachmentFailureRate) {
      out.push({
        key: "attachment_failures",
        severity: "warn",
        value: failed / finished,
        message: `${pct(failed / finished)} of attachments failed extraction in 24h (${failed}/${finished})`,
      });
    }
  }

  if (s.haltedSubscriptions) {
    out.push({
      key: "subscriptions_halted",
      severity: "info",
      value: s.haltedSubscriptions,
      message: `${s.haltedSubscriptions} subscription(s) HALTED — renewal payments are failing`,
    });
  }
  return out;
}

// ── ordering ─────────────────────────────────────────────────────────────────

const RANK: Record<Severity, number> = { critical: 0, warn: 1, info: 2 };

/** Worst first, then stable by key so the list doesn't reshuffle on reload. */
export function sortAnomalies(list: Anomaly[]): Anomaly[] {
  return [...list].sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.key.localeCompare(b.key));
}
