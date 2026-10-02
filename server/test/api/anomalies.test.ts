import { describe, expect, test } from "bun:test";
import {
  deepseekAnomalies,
  httpAnomalies,
  jobAnomalies,
  kimiAnomalies,
  primaryBalance,
  runtimeAnomalies,
  sandboxAnomalies,
  sortAnomalies,
  surfaceAnomalies,
  tavilyAnomalies,
  THRESHOLDS,
  type Anomaly,
} from "../../src/api/lib/anomalies";
import type { WindowMetrics } from "../../src/api/services/admin.service";
import type { ProcessStats } from "../../src/lib/telemetry";

const at = "2026-10-02T12:00:00.000Z";
const keys = (list: Anomaly[]) => list.map((a) => a.key);

function window(over: Partial<WindowMetrics> = {}): WindowMetrics {
  return {
    window: "1h",
    jobs: 40,
    succeeded: 40,
    failed: 0,
    cancelled: 0,
    successRate: 1,
    finishReasons: {},
    p50DurationSeconds: 60,
    p95DurationSeconds: 120,
    p50QueueWaitSeconds: 1,
    p95QueueWaitSeconds: 2,
    avgTurns: 5,
    credits: 40,
    creditsPerJob: 1,
    byEffort: {},
    toolCalls: 100,
    toolFailures: 0,
    toolFailureRate: 0,
    topFailingTools: [],
    sandboxProvisionFailureRate: 0,
    ...over,
  };
}

function proc(over: Partial<ProcessStats> = {}): ProcessStats {
  return {
    uptimeSeconds: 100,
    pid: 1,
    runtime: "bun",
    platform: "linux/arm64",
    release: null,
    memory: { rssMB: 300, heapUsedMB: 100, heapTotalMB: 200, externalMB: 10 },
    container: { limitMB: 2_048, usedMB: 400 },
    disk: { totalGB: 30, freeGB: 20 },
    load: [0, 0, 0],
    cpus: 2,
    eventLoop: { maxMs1m: 5, avgMs1m: 1, maxMs15m: 10 },
    ...over,
  };
}

describe("jobs", () => {
  const healthy = { stuckJobs: 0, orphanHolds: 0 };

  test("quiet when healthy", () => {
    expect(jobAnomalies(healthy, [window()])).toEqual([]);
  });

  test("stuck jobs are critical, orphan holds a warning", () => {
    const list = jobAnomalies({ stuckJobs: 2, orphanHolds: 1 }, []);
    expect(list.map((a) => [a.key, a.severity])).toEqual([
      ["stuck_jobs", "critical"],
      ["orphan_holds", "warn"],
    ]);
  });

  test("rates need the minimum sample", () => {
    const small = window({ jobs: 5, successRate: 0, failed: 5 });
    expect(jobAnomalies(healthy, [small])).toEqual([]);
    const big = window({ successRate: 0.85, failed: 6 });
    expect(keys(jobAnomalies(healthy, [big]))).toEqual(["job_failure_rate"]);
  });

  test("cost per job doubling against the day", () => {
    const list = jobAnomalies(healthy, [
      window({ creditsPerJob: 2.1 }),
      window({ window: "24h", creditsPerJob: 1 }),
    ]);
    expect(keys(list)).toEqual(["cost_per_job"]);
  });
});

describe("providers", () => {
  const ok = <T>(data: T) => ({ status: "ok" as const, data, fetchedAt: at });

  test("deepseek: low balance and unavailable are critical; at the threshold is fine", () => {
    const bal = (total: number) => ok({ available: true, balances: [{ currency: "USD", total, granted: 0, toppedUp: total }] });
    expect(deepseekAnomalies(bal(5), 5)).toEqual([]);
    expect(deepseekAnomalies(bal(4.99), 5)[0]?.severity).toBe("critical");
    expect(keys(deepseekAnomalies(ok({ available: false, balances: [] }), 5))).toEqual(["deepseek_unavailable"]);
    expect(keys(deepseekAnomalies({ status: "error", error: "HTTP 401", fetchedAt: at }, 5))).toEqual([
      "provider_check_failed:deepseek",
    ]);
    expect(deepseekAnomalies({ status: "unconfigured", fetchedAt: at }, 5)).toEqual([]);
  });

  test("primary balance is the largest currency", () => {
    expect(
      primaryBalance({
        available: true,
        balances: [
          { currency: "CNY", total: 1, granted: 0, toppedUp: 1 },
          { currency: "USD", total: 9, granted: 0, toppedUp: 9 },
        ],
      }),
    ).toEqual(expect.objectContaining({ currency: "USD", total: 9 }));
  });

  test("kimi and tavily", () => {
    expect(kimiAnomalies(ok({ currency: "USD", available: 1, voucher: 0, cash: 1 }))[0]?.key).toBe("kimi_low");
    expect(kimiAnomalies(ok({ currency: "USD", available: THRESHOLDS.kimiLowBalance, voucher: 0, cash: 2 }))).toEqual([]);

    const usage = (planUsage: number) =>
      ok({ plan: "Bootstrap", planUsage, planLimit: 1000, paygoUsage: 0, paygoLimit: 0, keyUsage: 0, keyLimit: null });
    expect(tavilyAnomalies(usage(900))).toEqual([]);
    expect(keys(tavilyAnomalies(usage(901)))).toEqual(["tavily_quota"]);
  });

  test("sandboxes: running orphans warn, stale rows are info", () => {
    const list = sandboxAnomalies({ status: "ok", orphans: 2, staleDbRows: 3 });
    expect(list.map((a) => [a.key, a.severity])).toEqual([
      ["e2b_orphans", "warn"],
      ["e2b_stale_rows", "info"],
    ]);
  });
});

describe("runtime", () => {
  test("healthy process is quiet", () => {
    expect(runtimeAnomalies(proc())).toEqual([]);
  });

  test("event-loop lag escalates to critical", () => {
    const lag = (ms: number) => runtimeAnomalies(proc({ eventLoop: { maxMs1m: ms, avgMs1m: 1, maxMs15m: ms } }));
    expect(lag(500)).toEqual([]);
    expect(lag(501)[0]?.severity).toBe("warn");
    expect(lag(2_001)[0]?.severity).toBe("critical");
  });

  test("memory against the container limit, falling back to RSS", () => {
    expect(keys(runtimeAnomalies(proc({ container: { limitMB: 1_000, usedMB: 900 } })))).toEqual(["memory_pressure"]);
    expect(
      keys(
        runtimeAnomalies(
          proc({
            container: { limitMB: null, usedMB: null },
            memory: { rssMB: 2_000, heapUsedMB: 0, heapTotalMB: 0, externalMB: 0 },
          }),
        ),
      ),
    ).toEqual(["memory_pressure"]);
  });

  test("disk and draining", () => {
    expect(keys(runtimeAnomalies(proc({ disk: { totalGB: 30, freeGB: 2 } }), true))).toEqual(["draining", "disk_low"]);
  });
});

describe("http", () => {
  test("5xx rate needs volume; error spikes are counted", () => {
    const http = (requests: number, s5xx: number) => ({
      requests,
      byClass: { "2xx": requests - s5xx, "3xx": 0, "4xx": 0, "5xx": s5xx },
      rate5xx: s5xx / requests,
    });
    expect(httpAnomalies(http(10, 5), { errors: 0 })).toEqual([]);
    expect(keys(httpAnomalies(http(100, 3), { errors: 21 }))).toEqual(["http_5xx_rate", "error_spike"]);
  });
});

describe("surfaces", () => {
  test("webhook backlog is critical; quiet when empty", () => {
    expect(surfaceAnomalies({})).toEqual([]);
    expect(surfaceAnomalies({ webhookBacklog: 1 })[0]?.severity).toBe("critical");
  });

  test("gateway, deploy and attachment failure rates honour their minimum samples", () => {
    expect(surfaceAnomalies({ gateway1h: { requests: 10, errors: 9 } })).toEqual([]);
    expect(keys(surfaceAnomalies({ gateway1h: { requests: 20, errors: 3 } }))).toEqual(["gateway_upstream_errors"]);
    expect(keys(surfaceAnomalies({ deploys24h: { FAILED: 2, READY: 3 } }))).toEqual(["deploy_failures"]);
    expect(surfaceAnomalies({ deploys24h: { FAILED: 2, READY: 2 } })).toEqual([]);
    expect(keys(surfaceAnomalies({ attachments24h: { FAILED: 3, READY: 7 } }))).toEqual(["attachment_failures"]);
  });
});

test("sorting puts critical first and is stable by key", () => {
  const a = (key: string, severity: Anomaly["severity"]): Anomaly => ({ key, severity, message: "", value: 0 });
  expect(keys(sortAnomalies([a("b", "info"), a("z", "warn"), a("c", "critical"), a("a", "warn")]))).toEqual([
    "c",
    "a",
    "z",
    "b",
  ]);
});
