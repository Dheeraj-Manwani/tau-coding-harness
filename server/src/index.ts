import "./load-env"; // must be first: populate process.env before service env.ts runs
import { initErrorReporting, flushErrorReporting } from "@/lib/log";
import http from "node:http";
import { buildApp, startApiBackground } from "@/api/index";
import { drainRunner, startRunner } from "@/worker/index";
import { isDraining, startDraining } from "@/lib/lifecycle";
import { prisma } from "@/lib/prisma";
import { log } from "@/api/lib/log";
import { mountSse } from "./sse-route";

const PORT = Number(process.env.PORT ?? 8080);

/**
 * How long running jobs get to finish after SIGTERM. Must stay below the
 * container's stop timeout (compose `stop_grace_period: 60s`), or Docker
 * SIGKILLs the process mid-drain and the margin is lost for nothing.
 */
const SHUTDOWN_GRACE_MS = Number(process.env.SHUTDOWN_GRACE_MS ?? 50_000);

// api HTTP + SSE stream/cancel on one app; the SSE routes are mounted via the
// buildApp hook so they sit before the global requireAuth.
// Before anything else can throw: installs the uncaught-exception and
// unhandled-rejection handlers. A no-op without SENTRY_DSN.
void initErrorReporting();

const app = buildApp(mountSse);
startApiBackground(); // hourly credit-hold sweep
startRunner(); // in-process BullMQ-free job consumer

http.createServer(app).listen(PORT, () =>
  console.log(`[economy] combined listening on ${PORT} (no redis, sse)`),
);

/**
 * Graceful shutdown. A deploy sends SIGTERM; exiting on the spot used to kill
 * every build in flight. Instead: fail health checks, stop starting jobs, give
 * running ones SHUTDOWN_GRACE_MS to finish, then exit. Anything still running
 * at the deadline is reaped on next boot.
 *
 * The HTTP server deliberately stays open while draining. This is a single
 * instance, so there is nowhere else for traffic to go: closing the listener
 * would turn every request into a proxy 502 for the whole window, including
 * the SSE reconnects of the very jobs being waited on. New prompts are the only
 * thing refused (the runner fails them with a "restarting" message).
 */
async function shutdown(signal: string): Promise<void> {
  if (isDraining()) {
    // Second signal (e.g. Ctrl+C twice in dev): stop waiting.
    process.exit(1);
  }
  startDraining();
  log.info("process.shutdown.start", { signal, graceMs: SHUTDOWN_GRACE_MS });

  const stillRunning = await drainRunner(SHUTDOWN_GRACE_MS);
  log.info("process.shutdown.done", { signal, stillRunning });

  await prisma.$disconnect().catch(() => {});
  await flushErrorReporting();
  process.exit(0);
}

// `bun --hot` re-runs this module in the same process; don't stack handlers.
process.removeAllListeners("SIGINT");
process.removeAllListeners("SIGTERM");
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
