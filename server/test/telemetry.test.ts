import { afterEach, describe, expect, test } from "bun:test";
import {
  errorSummary,
  eventLoopSummary,
  fingerprintOf,
  httpSummary,
  normaliseMessage,
  normaliseRoute,
  percentile,
  recordLag,
  recordLog,
  recordRequest,
  resetTelemetry,
} from "../src/lib/telemetry";
import type { LogRecord } from "../src/lib/log";

// A fixed minute boundary keeps bucket arithmetic exact.
const T0 = Date.UTC(2026, 9, 2, 12, 0, 0);
const MIN = 60_000;

afterEach(() => resetTelemetry());

const line = (over: Partial<LogRecord> = {}): LogRecord => ({
  ts: T0,
  level: "error",
  svc: "api",
  event: "exception",
  fields: { error: "boom" },
  ...over,
});

describe("normaliseRoute", () => {
  test("folds ids, keeps literal segments, drops the query", () => {
    expect(normaliseRoute("get", "/project/3f2b1c4e-1a2b-4c3d-8e9f-0a1b2c3d4e5f/files?x=1")).toBe(
      "GET /project/:id/files",
    );
    expect(normaliseRoute("GET", "/admin/jobs/123/events")).toBe("GET /admin/jobs/:id/events");
    expect(normaliseRoute("GET", "/v1/keys/tau_sk_live_ab12cd34")).toBe("GET /v1/keys/:id");
  });

  test("collapses published-site paths and caps depth and segment length", () => {
    expect(normaliseRoute("GET", "/sites/my-app/assets/index-abc.js")).toBe("GET /sites/*");
    expect(normaliseRoute("GET", "/a/b/c/d/e/f")).toBe("GET /a/b/c/d");
    expect(normaliseRoute("GET", `/x/${"y".repeat(41)}`)).toBe("GET /x/:long");
  });
});

describe("percentile", () => {
  test("nearest-rank on a sorted array", () => {
    const xs = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(xs, 0.5)).toBe(50);
    expect(percentile(xs, 0.95)).toBe(95);
    expect(percentile([], 0.5)).toBeNull();
  });
});

describe("http summary", () => {
  test("counts status classes and routes inside the window only", () => {
    recordRequest("GET /a", 200, 10, T0 - 30 * MIN);
    recordRequest("GET /a", 500, 30, T0);
    recordRequest("POST /b", 404, 5, T0);

    const last15 = httpSummary(15, T0);
    expect(last15.requests).toBe(2);
    expect(last15.byClass["5xx"]).toBe(1);
    expect(last15.rate5xx).toBe(0.5);
    expect(last15.failingRoutes.map((r) => r.route)).toEqual(["GET /a"]);

    const last60 = httpSummary(60, T0);
    expect(last60.requests).toBe(3);
    expect(last60.perMinute).toHaveLength(60);
    expect(last60.perMinute.at(-1)).toBe(2);
    expect(last60.perMinute.at(-31)).toBe(1);
  });

  test("route cardinality is capped; the overflow lands in 'other'", () => {
    for (let i = 0; i < 250; i++) recordRequest(`GET /r${i}`, 200, 1, T0);
    const s = httpSummary(60, T0);
    const other = [...s.topRoutes].find((r) => r.route === "other");
    expect(other?.count).toBe(50);
  });

  test("slow routes need a minimum sample", () => {
    recordRequest("GET /once", 200, 9_000, T0);
    for (let i = 0; i < 3; i++) recordRequest("GET /steady", 200, 100, T0);
    expect(httpSummary(60, T0).slowRoutes.map((r) => r.route)).toEqual(["GET /steady"]);
  });

  test("the ring keeps at most an hour", () => {
    recordRequest("GET /old", 200, 1, T0);
    recordRequest("GET /new", 200, 1, T0 + 61 * MIN);
    expect(httpSummary(60, T0 + 61 * MIN).requests).toBe(1);
  });
});

describe("error grouping", () => {
  test("same failure with different ids is one group", () => {
    expect(normaliseMessage('job 3f2b1c4e-1a2b-4c3d-8e9f-0a1b2c3d4e5f failed after 42 turns "x"')).toBe(
      "job <id> failed after <n> turns <str>",
    );
    recordLog(line({ fields: { error: "timeout after 1200ms" } }));
    recordLog(line({ ts: T0 + 1, fields: { error: "timeout after 3400ms" } }));
    recordLog(line({ ts: T0 + 2, event: "other", fields: { error: "timeout after 1ms" } }));

    const s = errorSummary({}, T0 + 2);
    expect(s.groups).toHaveLength(2);
    const timeout = s.groups.find((g) => g.event === "exception")!;
    expect(timeout.count).toBe(2);
    expect(timeout.fingerprint).toBe(fingerprintOf("exception", "timeout after <n>ms"));
    expect(s.last15m.errors).toBe(3);
    expect(s.recent[0]!.ts).toBe(T0 + 2);
  });

  test("ignores info lines and escalates a group's level to error", () => {
    recordLog(line({ level: "info" }));
    recordLog(line({ level: "warn" }));
    recordLog(line({ level: "error", ts: T0 + 1 }));
    const s = errorSummary({}, T0 + 1);
    expect(s.groups).toHaveLength(1);
    expect(s.groups[0]!.level).toBe("error");
    expect(s.last15m).toEqual({ errors: 1, warns: 1 });
  });
});

describe("event loop", () => {
  test("reports the worst lag in the last minute and the last fifteen", () => {
    recordLag(900, T0 - 10 * MIN);
    recordLag(10, T0);
    recordLag(30, T0);
    expect(eventLoopSummary(T0)).toEqual({ maxMs1m: 30, avgMs1m: 20, maxMs15m: 900 });
  });
});
