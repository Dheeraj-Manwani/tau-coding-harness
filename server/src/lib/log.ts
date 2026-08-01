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

// Sentry state is deliberately at MODULE scope, not per-logger. `combined.ts`
// runs both services in one process, so a per-logger hub would initialise the
// SDK twice. Same reasoning as the single PrismaClient in `lib/prisma.ts`.
let sentryHub: { captureException: (e: Error, hint?: unknown) => void } | null =
  null;
let sentryTried = false;

async function forwardToSentry(
  error: Error,
  context: LogContext,
  log: Logger,
): Promise<void> {
  if (!process.env.SENTRY_DSN) return;
  if (!sentryTried) {
    sentryTried = true;
    try {
      // Not a static import: the package is intentionally absent by default.
      const mod = (await import(
        /* @vite-ignore */ "@sentry/node" as string
      )) as {
        init: (o: Record<string, unknown>) => void;
        captureException: (e: Error, hint?: unknown) => void;
      };
      mod.init({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.NODE_ENV ?? "development",
      });
      sentryHub = mod;
    } catch {
      log.warn("sentry.unavailable", {
        detail: "SENTRY_DSN is set but @sentry/node is not installed",
      });
    }
  }
  sentryHub?.captureException(error, { tags: scrub(context) });
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
   * structured `error` line; if `SENTRY_DSN` is set *and* `@sentry/node` is
   * installed, it also forwards there. The dependency is deliberately not in
   * `package.json` — adding an error-tracking vendor is a billing/privacy
   * decision, not a code one, so the wiring is ready and inert until someone
   * opts in:
   *
   *     bun add @sentry/node   # in api/ and worker-service/
   *     SENTRY_DSN=https://…   # in the environment
   *
   * Note the redaction above applies to the structured line only. If you enable
   * Sentry, also set its `beforeSend` to strip prompt content.
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

    void forwardToSentry(error, context, log);
  }

  return { log, captureException };
}
