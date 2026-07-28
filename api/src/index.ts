import { env } from "./lib/env";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import passport from "passport";
import authRoutes from "./routes/auth.routes";
import projectRoutes from "./routes/project.routes";
import attachmentRoutes from "./routes/attachment.routes";
import creditsRoutes from "./routes/credits.routes";
import adminRoutes from "./routes/admin.routes";
import billingRoutes from "./routes/billing.routes";
import webhookRoutes from "./routes/webhook.routes";
import gatewayRoutes from "./routes/gateway.routes";
import aiRoutes from "./routes/ai.routes";
import accountRoutes from "./routes/account.routes";
import { keyEncryptionConfigured } from "./lib/apiKeys";
import { errorHandler, notFoundHandler } from "./middleware/error.middleware";
import { requireAuth } from "./middleware/auth.middleware";
import { requireAdminKey } from "./middleware/admin.middleware";
import {
  createSession,
  ui as adminUi,
} from "./controllers/admin.controller";
import { requestLogger } from "./middleware/logger.middleware";
import { sweepStuckHolds } from "./lib/credits";
import { captureException, log } from "./lib/log";
import { reapStaleJobs } from "./lib/jobs";
import { runAlertCheck } from "./lib/alerts";
import { sweepAttachments } from "./services/attachment.service";

/**
 * Terminate jobs whose owning process is gone, then settle the holds left behind
 * by terminal jobs. Order matters: reaping flips stranded rows to FAILED, and
 * `sweepStuckHolds` only settles holds whose job is already terminal — so
 * reaping first lets one pass clean up both halves of the same wreckage.
 *
 * @param onBoot nothing can legitimately be running yet, so skip the grace
 *               periods and reap every non-terminal row.
 */
async function runSweep(onBoot = false): Promise<void> {
  try {
    const { reaped, jobIds, errors } = await reapStaleJobs(onBoot);
    if (reaped > 0 || errors.length > 0) {
      log.info("jobs.reap", { onBoot, reaped, jobIds, errors });
    }
  } catch (err) {
    captureException(err, { detail: "stale-job reap failed" });
  }

  try {
    const { swept, errors } = await sweepStuckHolds();
    if (swept > 0 || errors.length > 0) {
      log.info("credits.sweep.scheduled", { swept, errors });
    }
  } catch (err) {
    captureException(err, { detail: "credit hold sweep failed" });
  }

  // Evaluate alerts last, so they see the post-cleanup state — otherwise every
  // sweep would page about the very rows it just fixed. Skipped on boot: the
  // reap has only just run and the metric windows are about a process that is
  // no longer the one serving traffic.
  if (!onBoot) await runAlertCheck();
}

async function runAttachmentSweep(): Promise<void> {
  try {
    const { orphansDeleted, stuckReset, errors } = await sweepAttachments();
    if (orphansDeleted > 0 || stuckReset > 0 || errors.length > 0) {
      log.info("attachments.sweep", { orphansDeleted, stuckReset, errors });
    }
  } catch (err) {
    captureException(err, { detail: "attachment sweep failed" });
  }
}

/**
 * Reap stranded jobs and reclaim stuck credit holds on startup, then every hour.
 * Extracted from top-level so combined (economy) mode can start it explicitly
 * after building the app.
 *
 * The boot pass is the one that matters: the in-process runner has no
 * durability, so any job still marked QUEUED/RUNNING when this process starts
 * was orphaned by whatever killed the last one. Left alone it would pin its
 * project's shimmer and 409 every future prompt on it, forever.
 */
export function startApiBackground(): void {
  void runSweep(true);
  setInterval(() => void runSweep(), 60 * 60 * 1000);

  void runAttachmentSweep();
  setInterval(() => void runAttachmentSweep(), 60 * 60 * 1000);
}

/**
 * Build the fully-configured Express app (all middleware + routes) without
 * binding a port, so it can be served standalone (below) or mounted onto a
 * shared http.Server in combined mode.
 */
export function buildApp(
  mountExtra?: (app: express.Express) => void,
): express.Express {
  const app = express();

  app.use(requestLogger);

  app.use(
    cors({
      origin: [env.APP_URL],
      credentials: true,
    }),
  );

  app.use("/webhooks", webhookRoutes);

  app.use(express.json());
  app.use(cookieParser());

  app.use(passport.initialize());

  app.use("/auth", authRoutes);

  // Two admin routes sit OUTSIDE the admin gate, deliberately:
  //   - `/admin/session` performs its own key check (it is how you get past the
  //     gate in a browser, which can't send a header on navigation);
  //   - `/admin/ui` is an empty HTML shell with no data in it — every number it
  //     shows is fetched from the guarded endpoints below, so serving the page
  //     to an unauthenticated visitor reveals nothing but a login box.
  app.post("/admin/session", createSession);
  app.get("/admin/ui", adminUi);
  app.use("/admin", requireAdminKey, adminRoutes);

  // Note: the dev-only BullMQ dashboard is removed in the economy build —
  // there is no BullMQ queue (jobs run through the in-process runner).

  // The AI gateway authenticates with a `tau_sk_*` key rather than a session
  // JWT, so like the admin routes it must sit above the global requireAuth.
  //
  // Two conditions gate mounting it at all, and both fail CLOSED — an
  // unmounted route 404s, which is strictly better than serving inference we
  // cannot encrypt keys for or cannot bill:
  //   - no TAU_KEY_ENC_SECRET  → no key could have been stored in the first place
  //   - GATEWAY_ENFORCE=false in production → would be an open, unbilled proxy
  //
  // Note this is NOT wired to CREDITS_ENFORCE, which defaults to false. Shadow
  // mode is right for the build path (it costs tau one job) and catastrophic
  // here (it costs tau every token anyone cares to spend).
  if (!keyEncryptionConfigured()) {
    log.warn("gateway.disabled", { reason: "TAU_KEY_ENC_SECRET is not set" });
  } else if (env.NODE_ENV === "production" && !env.GATEWAY_ENFORCE) {
    log.error("gateway.disabled", {
      reason: "GATEWAY_ENFORCE=false in production would serve unbilled inference",
    });
  } else {
    // Two dialects over one credential and one billing path:
    //   /v1  — OpenAI-compatible, for the SDK
    //   /ai  — small JSON shape, for plain `fetch` (what generated apps use)
    app.use("/v1", gatewayRoutes);
    app.use("/ai", aiRoutes);
    log.info("gateway.ready", { enforce: env.GATEWAY_ENFORCE });
  }

  // Economy: mount extra self-authenticating routes (the SSE event stream +
  // job cancel) BEFORE the global requireAuth so they can do their own token
  // check (EventSource can't send an Authorization header). No-op on master.
  mountExtra?.(app);

  app.use(requireAuth);

  app.use("/project", projectRoutes);
  app.use("/account", accountRoutes);
  app.use("/attachments", attachmentRoutes);
  app.use("/credits", creditsRoutes);
  app.use("/billing", billingRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

if (import.meta.main) {
  const app = buildApp();
  startApiBackground();
  app.listen(env.PORT, () => log.info("api.ready", { port: env.PORT }));
}
