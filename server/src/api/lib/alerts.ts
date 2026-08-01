import { env } from "@/lib/env";
import { log, captureException } from "./log";
import { getHealth, getMetrics } from "../services/admin.service";

/**
 * Operational alerting, evaluated from the hourly sweep that already runs — no
 * new scheduler, no second process.
 *
 * These are the alarms whose absence let a job sit RUNNING for days with a
 * user's project bricked behind it (doc/STUCK_THINKING_AND_TOOL_MESSAGES.md §5.6).
 * Every one of them alerts on a **count or a rate**, once per sweep — never per
 * row. An alert that fires a thousand times is an alert nobody reads.
 */

export type Severity = "warn" | "critical";

export interface Alert {
  key: string;
  severity: Severity;
  message: string;
  value: number;
}

/** Rates below this sample size are noise, not signal. */
const MIN_SAMPLE = 20;

const THRESHOLDS = {
  jobFailureRate: 0.1,
  sandboxProvisionFailureRate: 0.05,
  toolFailureRate: 0.1,
  p95DurationSeconds: 900,
};

export async function evaluateAlerts(): Promise<Alert[]> {
  const alerts: Alert[] = [];
  const [health, metrics] = await Promise.all([getHealth(), getMetrics()]);

  // 1 — the alarm that would have caught the original bug.
  if (health.stuckJobs > 0) {
    alerts.push({
      key: "stuck_jobs",
      severity: "critical",
      value: health.stuckJobs,
      message: `${health.stuckJobs} job(s) non-terminal with a cold heartbeat — their projects are refusing new prompts`,
    });
  }

  // 2 — leaked concurrency: holds outliving the job they were taken for.
  if (health.orphanHolds > 0) {
    alerts.push({
      key: "orphan_holds",
      severity: "warn",
      value: health.orphanHolds,
      message: `${health.orphanHolds} ACTIVE credit hold(s) behind a terminal job — concurrency slots leaked`,
    });
  }

  const hour = metrics.find((m) => m.window === "1h");
  if (hour && hour.jobs >= MIN_SAMPLE) {
    // 3a — overall failure rate.
    const failureRate =
      hour.successRate === null ? null : 1 - hour.successRate;
    if (failureRate !== null && failureRate > THRESHOLDS.jobFailureRate) {
      alerts.push({
        key: "job_failure_rate",
        severity: "critical",
        value: failureRate,
        message: `${(failureRate * 100).toFixed(1)}% of jobs failed in the last hour (${hour.failed}/${hour.jobs})`,
      });
    }

    // 3b — provisioning separately: §2.3 made these failures silent, so a
    // blended rate would hide them behind ordinary agent errors.
    if (
      hour.sandboxProvisionFailureRate !== null &&
      hour.sandboxProvisionFailureRate > THRESHOLDS.sandboxProvisionFailureRate
    ) {
      alerts.push({
        key: "sandbox_provision_failure_rate",
        severity: "critical",
        value: hour.sandboxProvisionFailureRate,
        message: `${(hour.sandboxProvisionFailureRate * 100).toFixed(1)}% of jobs failed with a sandbox error in the last hour`,
      });
    }

    // 4 — per-tool: the early warning for a broken template or sandbox change.
    if (
      hour.toolFailureRate !== null &&
      hour.toolCalls >= MIN_SAMPLE &&
      hour.toolFailureRate > THRESHOLDS.toolFailureRate
    ) {
      const worst = hour.topFailingTools
        .map((t) => `${t.tool} ${t.failures}/${t.calls}`)
        .join(", ");
      alerts.push({
        key: "tool_failure_rate",
        severity: "warn",
        value: hour.toolFailureRate,
        message: `tool failure rate ${(hour.toolFailureRate * 100).toFixed(1)}% in the last hour — ${worst}`,
      });
    }

    // 5 — duration/cost drift, the standing blind spot behind the cost items in
    // ISSUES_AND_SUGGESTIONS §2.2/2.4.
    if (
      hour.p95DurationSeconds !== null &&
      hour.p95DurationSeconds > THRESHOLDS.p95DurationSeconds
    ) {
      alerts.push({
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
      hour.creditsPerJob > day.creditsPerJob * 2
    ) {
      alerts.push({
        key: "cost_per_job",
        severity: "warn",
        value: hour.creditsPerJob,
        message: `credits/job ${hour.creditsPerJob.toFixed(2)} this hour vs ${day.creditsPerJob.toFixed(2)} over 24h`,
      });
    }
  }

  return alerts;
}

/**
 * Evaluate and deliver. Always logs (so the numbers exist in the drain even with
 * no webhook configured); posts to `ALERT_WEBHOOK_URL` when set.
 */
export async function runAlertCheck(): Promise<Alert[]> {
  let alerts: Alert[] = [];
  try {
    alerts = await evaluateAlerts();
  } catch (err) {
    captureException(err, { detail: "alert evaluation failed" });
    return [];
  }

  if (alerts.length === 0) return alerts;

  for (const a of alerts) {
    log.warn("alert", { key: a.key, severity: a.severity, value: a.value });
  }

  if (!env.ALERT_WEBHOOK_URL) return alerts;

  const text = [
    `*tau* — ${alerts.length} alert(s)`,
    ...alerts.map(
      (a) => `${a.severity === "critical" ? "🔴" : "🟠"} ${a.message}`,
    ),
  ].join("\n");

  try {
    // Slack and Discord both accept a bare `{content|text}` JSON body; send both
    // keys so either endpoint works without configuration.
    await fetch(env.ALERT_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, content: text }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    // Never let a webhook outage break the sweep that also reaps stuck jobs.
    captureException(err, { detail: "alert webhook delivery failed" });
  }

  return alerts;
}
