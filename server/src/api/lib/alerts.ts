import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { log, captureException } from "./log";
import {
  getHealth,
  getMetrics,
  type AdminHealth,
  type WindowMetrics,
} from "../services/admin.service";
import {
  deepseekAnomalies,
  jobAnomalies,
  sortAnomalies,
  storageAnomalies,
  webhookAnomalies,
  type Anomaly,
} from "./anomalies";
import { deepseekBalance } from "./providers";
import { storageConfigured } from "@/lib/storageBucket";
import { storageSignals } from "../services/storageAdmin.service";

/**
 * Operational alerting, evaluated from the hourly sweep that already runs — no
 * new scheduler, no second process.
 *
 * These are the alarms whose absence let a job sit RUNNING for days with a
 * user's project bricked behind it (doc/STUCK_THINKING_AND_TOOL_MESSAGES.md §5.6),
 * plus the two that cost money silently: the LLM account running dry, and a
 * payment webhook that never got processed.
 *
 * The rules themselves live in `anomalies.ts`, shared with the ops console so
 * the two never disagree. Only `warn` and `critical` page; `info` is
 * console-only.
 */

export type Severity = "warn" | "critical";

export interface Alert extends Anomaly {
  severity: Severity;
}

/** A webhook unprocessed for this long has failed, not merely queued. */
export const WEBHOOK_STALE_MS = 10 * 60_000;

export function countStaleWebhooks(): Promise<number> {
  return prisma.webhookEvent.count({
    where: { processedAt: null, createdAt: { lt: new Date(Date.now() - WEBHOOK_STALE_MS) } },
  });
}

/**
 * @param pre health/metrics the caller already computed (the console's
 *            overview), so they aren't computed twice.
 */
export async function evaluateAlerts(
  pre: { health?: AdminHealth; metrics?: WindowMetrics[] } = {},
): Promise<Alert[]> {
  const [health, metrics, deepseek, staleWebhooks, storage] = await Promise.all([
    pre.health ?? getHealth(),
    pre.metrics ?? getMetrics(),
    deepseekBalance(),
    countStaleWebhooks(),
    // Only where storage is on: an instance without a bucket has nothing to watch.
    storageConfigured() ? storageSignals() : Promise.resolve(null),
  ]);

  const all = [
    ...jobAnomalies(health, metrics),
    ...deepseekAnomalies(deepseek, env.DEEPSEEK_LOW_BALANCE),
    ...webhookAnomalies(staleWebhooks),
    ...(storage
      ? storageAnomalies(storage, { uploadsPerHour: env.STORAGE_UPLOAD_SPIKE_PER_HOUR, bucketBytes: env.STORAGE_ALERT_BYTES })
      : []),
  ];
  return sortAnomalies(all).filter((a): a is Alert => a.severity !== "info");
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
    log.warn("alert", { key: a.key, severity: a.severity, value: a.value, detail: a.message });
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
