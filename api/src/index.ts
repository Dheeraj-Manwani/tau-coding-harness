import { env } from "./lib/env";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import passport from "passport";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import authRoutes from "./routes/auth.routes";
import projectRoutes from "./routes/project.routes";
import creditsRoutes from "./routes/credits.routes";
import adminRoutes from "./routes/admin.routes";
import billingRoutes from "./routes/billing.routes";
import webhookRoutes from "./routes/webhook.routes";
import { errorHandler, notFoundHandler } from "./middleware/error.middleware";
import { requireAuth } from "./middleware/auth.middleware";
import { requireAdminKey } from "./middleware/admin.middleware";
import { requestLogger } from "./middleware/logger.middleware";
import { codeGenerationQueue } from "./lib/queue";

const app = express();
const PORT = env.PORT;
const isDev = env.NODE_ENV !== "production";

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

// Dev-only BullMQ dashboard.
if (isDev) {
  const bullBoardAdapter = new ExpressAdapter();
  bullBoardAdapter.setBasePath("/admin/queues");
  createBullBoard({
    queues: [new BullMQAdapter(codeGenerationQueue)],
    serverAdapter: bullBoardAdapter,
  });
  app.use("/admin/queues", bullBoardAdapter.getRouter());
}

app.use(requireAuth);

app.use("/project", projectRoutes);
app.use("/credits", creditsRoutes);
app.use("/billing", billingRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(PORT, () => console.log(`Server started on ${PORT}`));
