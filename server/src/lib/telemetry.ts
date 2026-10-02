import fs from "node:fs/promises";
import os from "node:os";
import { onLog, type LogLevel, type LogRecord } from "./log";

/**
 * In-process operational telemetry for the ops console.
 *
 * The admin console needs "how are requests going, what is erroring, is the
 * event loop healthy" without a metrics backend and without adding a single
 * write to the database the users are on. Everything here is memory-only and
 * hard-bounded:
 *
 *   - 60 one-minute buckets (a ring) of request counts, status classes, a
 *     latency reservoir, per-route stats, error/warn counts and event-loop lag;
 *   - at most `MAX_ROUTES` distinct route keys, ever;
 *   - at most `MAX_GROUPS` error fingerprints and `RECENT_MAX` raw error lines.
 *
 * It is deliberately per-process and resets on deploy. That is the right shape
 * for a single instance, and it is why logs are also shipped off-box: this is
 * the "what is happening now" view, the drain is the history.
 *
 * No `env` import, so it can be unit-tested without a full environment.
 */

const MINUTE_MS = 60_000;
const WINDOW_MINUTES = 60;
const SAMPLES_PER_BUCKET = 200;
const MAX_ROUTES = 200;
const MAX_GROUPS = 500;
const RECENT_MAX = 200;
const LAG_INTERVAL_MS = 1_000;

const OTHER_ROUTE = "other";

interface RouteStat {
  count: number;
  s4xx: number;
  s5xx: number;
  totalMs: number;
  maxMs: number;
}

interface Bucket {
  start: number;
  requests: number;
  byClass: Record<StatusClass, number>;
  /** Uniform reservoir of request latencies seen in this minute. */
  samples: number[];
  seen: number;
  routes: Map<string, RouteStat>;
  errors: number;
  warns: number;
  lagMaxMs: number;
  lagSumMs: number;
  lagCount: number;
}

type StatusClass = "2xx" | "3xx" | "4xx" | "5xx";

export interface ErrorGroup {
  fingerprint: string;
  event: string;
  level: LogLevel;
  svc: string;
  message: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
  /** Scrubbed fields of the most recent occurrence — ids, path, stack. */
  lastFields: Record<string, unknown>;
}

export interface RecentLogLine {
  ts: number;
  level: LogLevel;
  svc: string;
  event: string;
  message: string;
  fields: Record<string, unknown>;
}

// ── state ────────────────────────────────────────────────────────────────────

let buckets: Bucket[] = [];
let knownRoutes = new Set<string>();
let groups = new Map<string, ErrorGroup>();
let recent: RecentLogLine[] = [];
let trackingSince = Date.now();

let started = false;
let unsubscribe: (() => void) | null = null;
let lagTimer: ReturnType<typeof setInterval> | null = null;

function newBucket(start: number): Bucket {
  return {
    start,
    requests: 0,
    byClass: { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 },
    samples: [],
    seen: 0,
    routes: new Map(),
    errors: 0,
    warns: 0,
    lagMaxMs: 0,
    lagSumMs: 0,
    lagCount: 0,
  };
}

/** The bucket for `now`, creating it (and evicting the oldest) on rollover. */
function bucketAt(now: number): Bucket {
  const start = now - (now % MINUTE_MS);
  const last = buckets.at(-1);
  if (last && last.start === start) return last;
  // A clock step backwards (rare, but NTP does it) lands in the newest bucket
  // rather than creating one out of order.
  if (last && last.start > start) return last;
  const bucket = newBucket(start);
  buckets.push(bucket);
  if (buckets.length > WINDOW_MINUTES) buckets = buckets.slice(-WINDOW_MINUTES);
  return bucket;
}

/** Buckets whose minute falls inside the last `minutes` minutes of `now`. */
function bucketsWithin(minutes: number, now: number): Bucket[] {
  const cutoff = now - (now % MINUTE_MS) - (minutes - 1) * MINUTE_MS;
  return buckets.filter((b) => b.start >= cutoff);
}

// ── HTTP ─────────────────────────────────────────────────────────────────────

const ID_SEGMENT =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,}|\d+|tau_sk_\w+)$/i;

/**
 * Collapse a concrete URL into a low-cardinality route key.
 *
 * Express knows the matched pattern, but only while the router is still on the
 * stack — by the time `finish` fires it may have been restored. Normalising the
 * path is deterministic and works for every request, including ones that never
 * matched a route. Ids, long opaque segments and anything under `/sites/` are
 * folded so a crawler or a busy published site can't mint a key per URL.
 */
export function normaliseRoute(method: string, url: string): string {
  const path = url.split("?")[0]!.split("#")[0]!;
  let segments = path.split("/").filter(Boolean);
  if (segments[0] === "sites") segments = ["sites", "*"];
  const shaped = segments
    .slice(0, 4)
    .map((s) => (ID_SEGMENT.test(s) ? ":id" : s.length > 40 ? ":long" : s));
  return `${method.toUpperCase()} /${shaped.join("/")}`;
}

function statusClass(status: number): StatusClass {
  if (status >= 500) return "5xx";
  if (status >= 400) return "4xx";
  if (status >= 300) return "3xx";
  return "2xx";
}

/**
 * Record one finished request. `route` should already be normalised (see
 * `normaliseRoute`); keys beyond the cardinality cap are counted as `other`.
 */
export function recordRequest(
  route: string,
  status: number,
  durationMs: number,
  now = Date.now(),
): void {
  const bucket = bucketAt(now);
  bucket.requests++;
  bucket.byClass[statusClass(status)]++;

  bucket.seen++;
  if (bucket.samples.length < SAMPLES_PER_BUCKET) {
    bucket.samples.push(durationMs);
  } else {
    const slot = Math.floor(Math.random() * bucket.seen);
    if (slot < SAMPLES_PER_BUCKET) bucket.samples[slot] = durationMs;
  }

  let key = route;
  if (!knownRoutes.has(key)) {
    if (knownRoutes.size >= MAX_ROUTES) key = OTHER_ROUTE;
    else knownRoutes.add(key);
  }
  const stat = bucket.routes.get(key) ?? {
    count: 0,
    s4xx: 0,
    s5xx: 0,
    totalMs: 0,
    maxMs: 0,
  };
  stat.count++;
  if (status >= 500) stat.s5xx++;
  else if (status >= 400) stat.s4xx++;
  stat.totalMs += durationMs;
  stat.maxMs = Math.max(stat.maxMs, durationMs);
  bucket.routes.set(key, stat);
}

export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1);
  return sorted[Math.max(0, idx)] ?? null;
}

export interface RouteSummary {
  route: string;
  count: number;
  s4xx: number;
  s5xx: number;
  avgMs: number;
  maxMs: number;
}

export interface HttpSummary {
  windowMinutes: number;
  trackingSince: string;
  requests: number;
  byClass: Record<StatusClass, number>;
  rate5xx: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  /** Requests per minute, oldest first, zero-filled — a sparkline's worth. */
  perMinute: number[];
  topRoutes: RouteSummary[];
  slowRoutes: RouteSummary[];
  failingRoutes: RouteSummary[];
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

export function httpSummary(
  windowMinutes = WINDOW_MINUTES,
  now = Date.now(),
): HttpSummary {
  const within = bucketsWithin(windowMinutes, now);
  const byClass: Record<StatusClass, number> = { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 };
  const samples: number[] = [];
  const routes = new Map<string, RouteStat>();
  let requests = 0;

  for (const b of within) {
    requests += b.requests;
    for (const k of Object.keys(byClass) as StatusClass[]) byClass[k] += b.byClass[k];
    samples.push(...b.samples);
    for (const [route, s] of b.routes) {
      const acc = routes.get(route) ?? { count: 0, s4xx: 0, s5xx: 0, totalMs: 0, maxMs: 0 };
      acc.count += s.count;
      acc.s4xx += s.s4xx;
      acc.s5xx += s.s5xx;
      acc.totalMs += s.totalMs;
      acc.maxMs = Math.max(acc.maxMs, s.maxMs);
      routes.set(route, acc);
    }
  }
  samples.sort((a, b) => a - b);

  const currentStart = now - (now % MINUTE_MS);
  const perMinute: number[] = [];
  for (let i = windowMinutes - 1; i >= 0; i--) {
    const start = currentStart - i * MINUTE_MS;
    perMinute.push(within.find((b) => b.start === start)?.requests ?? 0);
  }

  const summaries: RouteSummary[] = [...routes.entries()].map(([route, s]) => ({
    route,
    count: s.count,
    s4xx: s.s4xx,
    s5xx: s.s5xx,
    avgMs: round1(s.totalMs / s.count),
    maxMs: round1(s.maxMs),
  }));

  const pct = (p: number): number | null => {
    const v = percentile(samples, p);
    return v === null ? null : round1(v);
  };

  return {
    windowMinutes,
    trackingSince: new Date(trackingSince).toISOString(),
    requests,
    byClass,
    rate5xx: requests > 0 ? byClass["5xx"] / requests : null,
    p50Ms: pct(0.5),
    p95Ms: pct(0.95),
    p99Ms: pct(0.99),
    perMinute,
    topRoutes: [...summaries].sort((a, b) => b.count - a.count).slice(0, 10),
    // A route hit twice is an anecdote, not a slow route.
    slowRoutes: summaries
      .filter((s) => s.count >= 3)
      .sort((a, b) => b.avgMs - a.avgMs)
      .slice(0, 10),
    failingRoutes: summaries
      .filter((s) => s.s5xx > 0)
      .sort((a, b) => b.s5xx - a.s5xx)
      .slice(0, 10),
  };
}

// ── errors ───────────────────────────────────────────────────────────────────

const MESSAGE_KEYS = ["error", "message", "detail", "reason"] as const;

function messageOf(fields: Record<string, unknown>): string {
  for (const key of MESSAGE_KEYS) {
    const v = fields[key];
    if (typeof v === "string" && v) return v;
    if (v && typeof v === "object" && typeof (v as { message?: unknown }).message === "string") {
      return (v as { message: string }).message;
    }
  }
  return "";
}

/**
 * Strip the parts of a message that differ between occurrences of the same
 * failure — ids, numbers, quoted values — so they group together.
 */
export function normaliseMessage(message: string): string {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replace(/\b[0-9a-f]{16,}\b/gi, "<hex>")
    .replace(/"[^"]{0,200}"|'[^']{0,200}'/g, "<str>")
    .replace(/\d+(\.\d+)?/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

export function fingerprintOf(event: string, message: string): string {
  return `${event}|${normaliseMessage(message)}`;
}

/** Feed one emitted log line. Only warn/error are kept. Exported for tests. */
export function recordLog(record: LogRecord): void {
  if (record.level !== "warn" && record.level !== "error") return;

  const bucket = bucketAt(record.ts);
  if (record.level === "error") bucket.errors++;
  else bucket.warns++;

  const message = messageOf(record.fields);
  const fingerprint = fingerprintOf(record.event, message);

  recent.push({
    ts: record.ts,
    level: record.level,
    svc: record.svc,
    event: record.event,
    message,
    fields: record.fields,
  });
  if (recent.length > RECENT_MAX) recent = recent.slice(-RECENT_MAX);

  const existing = groups.get(fingerprint);
  if (existing) {
    existing.count++;
    existing.lastSeen = record.ts;
    existing.lastFields = record.fields;
    // An error and a warn with the same text are the same problem; report the
    // worse of the two.
    if (record.level === "error") existing.level = "error";
    return;
  }

  if (groups.size >= MAX_GROUPS) {
    let oldestKey: string | null = null;
    let oldest = Infinity;
    for (const [k, g] of groups) {
      if (g.lastSeen < oldest) {
        oldest = g.lastSeen;
        oldestKey = k;
      }
    }
    if (oldestKey) groups.delete(oldestKey);
  }

  groups.set(fingerprint, {
    fingerprint,
    event: record.event,
    level: record.level,
    svc: record.svc,
    message,
    count: 1,
    firstSeen: record.ts,
    lastSeen: record.ts,
    lastFields: record.fields,
  });
}

export interface ErrorSummary {
  trackingSince: string;
  last15m: { errors: number; warns: number };
  last60m: { errors: number; warns: number };
  groups: ErrorGroup[];
  recent: RecentLogLine[];
}

export function errorSummary(
  opts: { groups?: number; recent?: number } = {},
  now = Date.now(),
): ErrorSummary {
  const count = (minutes: number) =>
    bucketsWithin(minutes, now).reduce(
      (acc, b) => ({ errors: acc.errors + b.errors, warns: acc.warns + b.warns }),
      { errors: 0, warns: 0 },
    );
  return {
    trackingSince: new Date(trackingSince).toISOString(),
    last15m: count(15),
    last60m: count(60),
    groups: [...groups.values()]
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .slice(0, opts.groups ?? 100),
    recent: recent.slice(-(opts.recent ?? RECENT_MAX)).reverse(),
  };
}

// ── event loop ───────────────────────────────────────────────────────────────

/** Feed one lag sample. Exported for tests. */
export function recordLag(lagMs: number, now = Date.now()): void {
  const bucket = bucketAt(now);
  bucket.lagMaxMs = Math.max(bucket.lagMaxMs, lagMs);
  bucket.lagSumMs += lagMs;
  bucket.lagCount++;
}

export interface EventLoopSummary {
  maxMs1m: number;
  avgMs1m: number;
  maxMs15m: number;
}

export function eventLoopSummary(now = Date.now()): EventLoopSummary {
  const last = bucketsWithin(1, now);
  const quarter = bucketsWithin(15, now);
  const sum = last.reduce((n, b) => n + b.lagSumMs, 0);
  const cnt = last.reduce((n, b) => n + b.lagCount, 0);
  return {
    maxMs1m: Math.max(0, ...last.map((b) => b.lagMaxMs)),
    avgMs1m: cnt > 0 ? round1(sum / cnt) : 0,
    maxMs15m: Math.max(0, ...quarter.map((b) => b.lagMaxMs)),
  };
}

// ── process / container ──────────────────────────────────────────────────────

async function readCgroupNumber(path: string): Promise<number | null> {
  try {
    const text = (await fs.readFile(path, "utf8")).trim();
    if (text === "max") return null;
    const n = Number(text);
    // cgroup v1 reports "unlimited" as a near-2^63 sentinel.
    return Number.isFinite(n) && n > 0 && n < 2 ** 60 ? n : null;
  } catch {
    return null;
  }
}

/** Memory limit and usage of this container, from cgroup v2 then v1. */
async function containerMemory(): Promise<{ limitMB: number | null; usedMB: number | null }> {
  const toMB = (n: number | null) => (n === null ? null : Math.round(n / 1024 / 1024));
  const v2Limit = await readCgroupNumber("/sys/fs/cgroup/memory.max");
  const v2Used = await readCgroupNumber("/sys/fs/cgroup/memory.current");
  if (v2Used !== null) return { limitMB: toMB(v2Limit), usedMB: toMB(v2Used) };
  const v1Limit = await readCgroupNumber("/sys/fs/cgroup/memory/memory.limit_in_bytes");
  const v1Used = await readCgroupNumber("/sys/fs/cgroup/memory/memory.usage_in_bytes");
  return { limitMB: toMB(v1Limit), usedMB: toMB(v1Used) };
}

async function diskUsage(): Promise<{ totalGB: number; freeGB: number } | null> {
  try {
    const s = await fs.statfs("/");
    const gb = (blocks: number) => Math.round(((blocks * s.bsize) / 1024 ** 3) * 10) / 10;
    return { totalGB: gb(s.blocks), freeGB: gb(s.bavail) };
  } catch {
    return null;
  }
}

export interface ProcessStats {
  uptimeSeconds: number;
  pid: number;
  runtime: string;
  platform: string;
  release: string | null;
  memory: { rssMB: number; heapUsedMB: number; heapTotalMB: number; externalMB: number };
  container: { limitMB: number | null; usedMB: number | null };
  disk: { totalGB: number; freeGB: number } | null;
  /** Host load averages — inside a container these are the host's, not ours. */
  load: number[];
  cpus: number;
  eventLoop: EventLoopSummary;
}

export async function processStats(now = Date.now()): Promise<ProcessStats> {
  const mem = process.memoryUsage();
  const mb = (n: number) => Math.round(n / 1024 / 1024);
  const [container, disk] = await Promise.all([containerMemory(), diskUsage()]);
  return {
    uptimeSeconds: Math.round(process.uptime()),
    pid: process.pid,
    runtime: process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.versions.node}`,
    platform: `${process.platform}/${process.arch}`,
    release: process.env.GIT_SHA || null,
    memory: {
      rssMB: mb(mem.rss),
      heapUsedMB: mb(mem.heapUsed),
      heapTotalMB: mb(mem.heapTotal),
      externalMB: mb(mem.external),
    },
    container,
    disk,
    load: os.loadavg().map((n) => Math.round(n * 100) / 100),
    cpus: os.cpus().length,
    eventLoop: eventLoopSummary(now),
  };
}

// ── lifecycle ────────────────────────────────────────────────────────────────

/**
 * Start collecting: subscribe to warn/error log lines and sample event-loop lag
 * once a second. Idempotent (`bun --hot` re-runs the entrypoint). The timer is
 * `unref`'d so it never holds the process open on shutdown.
 *
 * Lag is measured as timer drift rather than with
 * `perf_hooks.monitorEventLoopDelay`, which Bun does not reliably implement. A
 * 1 s timer that fires 400 ms late means every request and SSE frame in that
 * window waited too — on a single process that is every user at once.
 */
export function startTelemetry(): void {
  if (started) return;
  started = true;
  trackingSince = Date.now();
  unsubscribe = onLog(recordLog);

  let expected = Date.now() + LAG_INTERVAL_MS;
  lagTimer = setInterval(() => {
    const now = Date.now();
    recordLag(Math.max(0, now - expected), now);
    expected = now + LAG_INTERVAL_MS;
  }, LAG_INTERVAL_MS);
  lagTimer.unref?.();
}

/** Drop all state and stop collecting. For tests. */
export function resetTelemetry(): void {
  unsubscribe?.();
  unsubscribe = null;
  if (lagTimer) clearInterval(lagTimer);
  lagTimer = null;
  started = false;
  buckets = [];
  knownRoutes = new Set();
  groups = new Map();
  recent = [];
  trackingSince = Date.now();
}
