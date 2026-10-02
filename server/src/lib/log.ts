/**
 * One structured-logging helper, shared by `api` and `worker-service`.
 *
 * This file used to exist twice — 191 identical lines in each service's
 * `lib/log.ts`, differing only in the `svc` tag. It is now a factory: each
 * service calls `createLogger()` with its own name from a small shim at
 * `src/lib/log.ts`, so every existing `import { log } from ".../lib/log"`
 * keeps working untouched.
 *
 * The point is not prettiness. Every line is a single JSON object with a fixed
 * envelope, so a log drain (Better Stack / Axiom / Loki) can index it and
 * `jobId` becomes a **correlation key**: one query reconstructs an entire run
 * end to end, across the runner, the agent loop, every tool call and the
 * sandbox. Bare `console.log("[worker] something", err)` cannot do that, which
 * is why a job could sit stuck for days with the evidence technically "logged".
 *
 * Event names are dotted and stable — `job.start`, `job.turn`, `job.tool`,
 * `sandbox.provision` — so they can be grouped and alerted on. Treat them as an
 * API: renaming one breaks whatever dashboard reads it.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

/** Correlation ids every event should carry when it has them. */
export interface LogContext {
  jobId?: string;
  projectId?: string;
  userId?: string;
  [key: string]: unknown;
}

export interface Logger {
  debug: (event: string, fields?: LogContext) => void;
  info: (event: string, fields?: LogContext) => void;
  warn: (event: string, fields?: LogContext) => void;
  error: (event: string, fields?: LogContext) => void;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const MIN_LEVEL: LogLevel =
  (process.env.LOG_LEVEL as LogLevel | undefined) ?? "info";

/**
 * Values that must never reach a log drain. Prompts, file contents and model
 * output are user content; a third-party log index is not where they belong.
 * Keys are matched case-insensitively against the whole field name.
 */
const REDACTED_KEYS = new Set([
  "prompt",
  "content",
  "message_content",
  "summary",
  "diff",
  "output",
  "input",
  "answer",
  "question",
  "apikey",
  "api_key",
  "token",
  "password",
  "secret",
]);

const MAX_STRING = 512;

function scrub(value: unknown, key?: string): unknown {
  if (key && REDACTED_KEYS.has(key.toLowerCase())) return "[redacted]";
  if (typeof value === "string") {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  }
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => scrub(v));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = scrub(v, k);
    }
    return out;
  }
  return value;
}

/**
 * Human-readable output for local work, JSON for anything that ships logs.
 * Structured logging is for the drain; a developer watching a sub-agent work in
 * a terminal is better served by one compact line. Same events, same fields —
 * only the rendering differs, so nothing is lost by flipping this.
 */
const PRETTY =
  process.env.LOG_PRETTY === "true" ||
  (process.env.LOG_PRETTY !== "false" &&
    process.env.NODE_ENV !== "production");

function renderPretty(
  level: LogLevel,
  event: string,
  fields: Record<string, unknown>,
): string {
  const time = new Date().toISOString().slice(11, 19);
  const rest = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(" ");
  return `${time} ${level.padEnd(5)} ${event}${rest ? ` ${rest}` : ""}`;
}

export interface LogRecord {
  ts: number;
  level: LogLevel;
  svc: string;
  event: string;
  /** Already scrubbed — safe to keep in memory and show to an operator. */
  fields: Record<string, unknown>;
}

/**
 * In-process subscribers to emitted lines. This is how the admin console's
 * "recent errors" view sees what the drain sees without a drain: lib/telemetry
 * listens here and keeps a bounded ring. Module scope for the same reason as the
 * Sentry hub below — one process, one set of listeners.
 */
const listeners = new Set<(record: LogRecord) => void>();

export function onLog(listener: (record: LogRecord) => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

// ── error reporting (Sentry) ────────────────────────────────────────────────
//
// State is deliberately at MODULE scope, not per-logger: the api and the
// worker run in one process, and a per-logger client would initialise the SDK
// twice. Same reasoning as the single PrismaClient in `lib/prisma.ts`.
//
// Inert unless SENTRY_DSN is set. The SDK is imported dynamically so a process
// without a DSN never loads it.

interface SentryLike {
  init: (options: Record<string, unknown>) => unknown;
  captureException: (error: unknown, hint?: Record<string, unknown>) => string;
  flush: (timeoutMs?: number) => Promise<boolean>;
}

let sentry: SentryLike | null = null;
let sentryInit: Promise<SentryLike | null> | null = null;

/** Query-string values that carry credentials (mirrors api/middleware/logger). */
const SECRET_PARAMS = /([?&](?:token|access_token|refresh_token|code|state|key)=)[^&#]*/gi;
const redactUrl = (url: string): string => url.replace(SECRET_PARAMS, "$1[redacted]");

/**
 * Strip everything that could carry user content or a credential before an
 * event leaves the box. The structured log line is already scrubbed by
 * `scrub()`; this is the same promise for what goes to Sentry.
 */
function scrubEvent(event: Record<string, any>): Record<string, any> {
  if (event.request) {
    // Bodies are prompts, files, passwords. Cookies and auth headers are sessions.
    delete event.request.data;
    delete event.request.cookies;
    if (event.request.url) event.request.url = redactUrl(String(event.request.url));
    if (event.request.query_string) delete event.request.query_string;
    if (event.request.headers) {
      const ua = event.request.headers["user-agent"];
      event.request.headers = ua ? { "user-agent": ua } : {};
    }
  }
  // Callers are meant to pass already-redacted URLs; don't depend on it.
  if (event.extra) event.extra = redactUrlsDeep(scrub(event.extra));
  if (event.contexts) event.contexts = redactUrlsDeep(scrub(event.contexts));
  return event;
}

function redactUrlsDeep(value: unknown): any {
  if (typeof value === "string") return redactUrl(value);
  if (Array.isArray(value)) return value.map(redactUrlsDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactUrlsDeep(v)]));
  }
  return value;
}

/**
 * Start error reporting. Call once, as early as possible, so a crash before
 * the first `captureException` is still reported (the SDK installs the
 * uncaught-exception and unhandled-rejection handlers here). Safe to call more
 * than once; a missing DSN makes it a no-op.
 */
export function initErrorReporting(): Promise<SentryLike | null> {
  if (!process.env.SENTRY_DSN) return Promise.resolve(null);
  sentryInit ??= (async () => {
    try {
      const mod = (await import("@sentry/bun")) as unknown as SentryLike;
      mod.init({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.NODE_ENV ?? "development",
        // The commit baked into the image (Dockerfile ARG), so an issue says
        // which deploy introduced it.
        release: process.env.GIT_SHA || undefined,
        // Errors only. Performance tracing would spend the free quota on spans.
        tracesSampleRate: 0,
        sendDefaultPii: false,
        beforeSend: (event: Record<string, any>) => scrubEvent(event),
        beforeBreadcrumb: (crumb: Record<string, any>) => {
          // Console breadcrumbs duplicate the structured log line already in
          // the event; drop them rather than ship every line twice.
          if (crumb.category === "console") return null;
          if (crumb.data?.url) crumb.data.url = redactUrl(String(crumb.data.url));
          return crumb;
        },
      });
      sentry = mod;
      return mod;
    } catch (err) {
      console.error(
        JSON.stringify({ level: "warn", event: "sentry.unavailable", detail: String(err) }),
      );
      return null;
    }
  })();
  return sentryInit;
}

/** Drain queued events before exit; a deploy's SIGTERM would otherwise drop them. */
export async function flushErrorReporting(timeoutMs = 2_000): Promise<void> {
  if (!sentry) return;
  await sentry.flush(timeoutMs).catch(() => false);
}

async function forwardToSentry(svc: string, error: Error, context: LogContext): Promise<void> {
  const client = sentry ?? (await initErrorReporting());
  if (!client) return;
  const tag = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  client.captureException(error, {
    // Tags are indexed and searchable: keep them to correlation ids.
    tags: { svc, jobId: tag(context.jobId), projectId: tag(context.projectId) },
    user: tag(context.userId) ? { id: context.userId } : undefined,
    extra: scrub(context) as Record<string, unknown>,
  });
}

/**
 * Build the logging surface for one service.
 *
 * @param svc value of the `svc` field on every JSON line — the only thing that
 *            differed between the two former copies of this file.
 */
export function createLogger(svc: string): {
  log: Logger;
  captureException: (err: unknown, context?: LogContext) => void;
} {
  function emit(level: LogLevel, event: string, fields: LogContext = {}): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[MIN_LEVEL]) return;
    const scrubbed = scrub(fields) as Record<string, unknown>;
    const line = PRETTY
      ? renderPretty(level, event, scrubbed)
      : JSON.stringify({
          ts: new Date().toISOString(),
          level,
          svc,
          event,
          ...scrubbed,
        });
    if (level === "error") console.error(line);
    else console.log(line);

    if (listeners.size === 0) return;
    const record: LogRecord = { ts: Date.now(), level, svc, event, fields: scrubbed };
    for (const listener of listeners) {
      // A broken subscriber must never take logging down with it.
      try {
        listener(record);
      } catch {
        /* ignore */
      }
    }
  }

  const log: Logger = {
    debug: (event, fields) => emit("debug", event, fields),
    info: (event, fields) => emit("info", event, fields),
    warn: (event, fields) => emit("warn", event, fields),
    error: (event, fields) => emit("error", event, fields),
  };

  /**
   * Report an exception with its correlation context.
   *
   * This is the **single seam** for error reporting. It always emits a
   * structured `error` line; when `SENTRY_DSN` is set it also forwards to
   * Sentry (`@sentry/bun`), tagged with the service and correlation ids. With no
   * DSN the SDK is never even loaded.
   *
   * What reaches Sentry is scrubbed the same way the log line is: request
   * bodies, cookies and auth headers are dropped in `beforeSend`, credential
   * query params are redacted, and `extra` goes through `scrub()`.
   */
  function captureException(err: unknown, context: LogContext = {}): void {
    const error =
      err instanceof Error
        ? err
        : new Error(typeof err === "string" ? err : String(err));

    log.error("exception", {
      ...context,
      error: error.message,
      errorName: error.name,
      stack: error.stack,
    });

    void forwardToSentry(svc, error, context);
  }

  return { log, captureException };
}
