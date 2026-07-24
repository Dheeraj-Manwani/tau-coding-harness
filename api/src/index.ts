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
import { errorHandler, notFoundHandler } from "./middleware/error.middleware";
import { requireAuth } from "./middleware/auth.middleware";
import { requireAdminKey } from "./middleware/admin.middleware";
import { requestLogger } from "./middleware/logger.middleware";
import { sweepStuckHolds } from "./lib/credits";
import { sweepAttachments } from "./services/attachment.service";

async function runSweep(): Promise<void> {
  try {
    const { swept, errors } = await sweepStuckHolds();
    if (swept > 0 || errors.length > 0) {
      console.log(
        JSON.stringify({
          ts: new Date().toISOString(),
          event: "credits.sweep.scheduled",
          swept,
          errors,
        }),
      );
    }
  } catch (err) {
    console.error("[credits] scheduled sweep failed:", err);
  }
}

async function runAttachmentSweep(): Promise<void> {
  try {
    const { orphansDeleted, stuckReset, errors } = await sweepAttachments();
    if (orphansDeleted > 0 || stuckReset > 0 || errors.length > 0) {
      console.log(
        JSON.stringify({
          ts: new Date().toISOString(),
          event: "attachments.sweep",
          orphansDeleted,
          stuckReset,
          errors,
        }),
      );
    }
  } catch (err) {
    console.error("[attachments] scheduled sweep failed:", err);
  }
}

/**
 * Reclaim stuck credit holds on startup and every hour thereafter. Extracted
 * from top-level so combined (economy) mode can start it explicitly after
 * building the app.
 */
export function startApiBackground(): void {
  void runSweep();
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
  app.use("/admin", requireAdminKey, adminRoutes);

  // Note: the dev-only BullMQ dashboard is removed in the economy build —
  // there is no BullMQ queue (jobs run through the in-process runner).

  // Economy: mount extra self-authenticating routes (the SSE event stream +
  // job cancel) BEFORE the global requireAuth so they can do their own token
  // check (EventSource can't send an Authorization header). No-op on master.
  mountExtra?.(app);

  app.use(requireAuth);

  app.use("/project", projectRoutes);
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
  app.listen(env.PORT, () => console.log(`Server started on ${env.PORT}`));
}
