import type { Request, Response, NextFunction } from "express";
import { prisma } from "@/lib/prisma";
import {
  reconcileAccount,
  reconcileJob,
  sweepStuckHolds,
  type ReconcileAccountResult,
} from "@/lib/credits";
import { Errors } from "../lib/errors";
import { bus } from "@/lib/bus";
import { ADMIN_COOKIE } from "../middleware/admin.middleware";
import * as admin from "../services/admin.service";
import * as overviewService from "../services/adminOverview.service";
import { getCostSeed } from "../services/adminCosts.service";

/** Wrap an async handler so a rejection reaches the error middleware. */
function handler(
  fn: (req: Request, res: Response) => Promise<unknown> | unknown,
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = await fn(req, res);
      if (body !== undefined && !res.headersSent) res.json(body);
    } catch (err) {
      next(err);
    }
  };
}

// ── session ──────────────────────────────────────────────────────────────────

// Sessions are minted by the Google round trip only (`/auth/google?client=admin`,
// see auth.controller.ts). Signing out just drops the cookie.
export const destroySession = handler((_req, res) => {
  res.clearCookie(ADMIN_COOKIE, { path: "/admin" });
  return { ok: true };
});

// ── observability ────────────────────────────────────────────────────────────

export const health = handler(() => admin.getHealth());

export const listJobs = handler((req) =>
  admin.listJobs({
    status: req.query.status as string | undefined,
    userId: req.query.userId as string | undefined,
    projectId: req.query.projectId as string | undefined,
    since: req.query.since as string | undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
  }),
);

export const jobDetail = handler((req) =>
  admin.getJobDetail(String(req.params.id)),
);

export const jobEvents = handler((req) =>
  admin.getJobEvents(String(req.params.id)),
);

export const metrics = handler(() => admin.getMetrics());

export const sandboxes = handler((req) =>
  admin.getSandboxInventory(req.query.check === "true"),
);

export const userDetail = handler((req) =>
  admin.getUserDetail(String(req.params.id)),
);

export const projectDetail = handler((req) =>
  admin.getProjectDetail(String(req.params.id)),
);

/** Gateway traffic across every key — the abuse-triage view. `?hours=` (default 24). */
export const gatewayOverview = handler((req) => {
  const raw = Number(req.query.hours);
  return admin.getGatewayOverview(
    Number.isFinite(raw) && raw > 0 ? { hours: raw } : {},
  );
});

/**
 * SSE firehose of live registry transitions across every job — the "what is the
 * box doing right now" view. Reuses the same event plumbing as the user stream.
 */
export function stream(req: Request, res: Response): void {
  res.status(200).set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  const send = (data: unknown): void => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Seed with the current picture so a fresh subscriber isn't blank until the
  // next transition happens — which on a quiet box could be minutes.
  send({ type: "snapshot", jobs: bus.registrySnapshot() });

  const off = bus.onRegistryChange((entry) =>
    send({ type: "change", job: entry }),
  );
  const heartbeat = setInterval(() => res.write(": hb\n\n"), 30_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    off();
    res.end();
  });
}

/**
 * The ops console's whole dashboard in one cached snapshot. `?fresh=1` asks for
 * a recompute (honoured at most every 10 s).
 */
export const overview = handler((req) =>
  overviewService.getOverview(req.query.fresh === "1"),
);

/** Grouped warn/error lines since this process started. */
export const errors = handler(() => overviewService.getErrors());

/** E2B's running sandboxes joined to projects; orphans and stale rows flagged. */
export const liveSandboxes = handler((req) =>
  overviewService.getLiveSandboxes(req.query.fresh === "1"),
);

export const searchUsers = handler((req) =>
  overviewService.searchUsers(
    typeof req.query.q === "string" ? req.query.q : undefined,
  ),
);

// ── incident tools ───────────────────────────────────────────────────────────

export const killSandbox = handler((req) =>
  overviewService.killOrphanSandbox(String(req.params.id)),
);

export const killJob = handler((req) => admin.killJob(String(req.params.id)));

export const reconcileStuckJobs = handler(() => admin.reconcileStuck());

export const releaseHolds = handler((req) =>
  admin.releaseUserHolds(String(req.params.id)),
);

// ── cost calculator ──────────────────────────────────────────────────────────

/** Catalog + provider-rate seed for the console's unit-economics calculator. */
export const costSeed = handler(() => getCostSeed());

// ── credits reconciliation (pre-existing) ────────────────────────────────────

export async function reconcileUser(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.query.userId as string | undefined;
    if (!userId) {
      next(Errors.badRequest("userId query param required"));
      return;
    }
    const result = await reconcileAccount(userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function reconcileAll(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const accounts = await prisma.billingAccount.findMany({
      select: { userId: true },
    });
    const results = await Promise.all(
      accounts.map(({ userId }) => reconcileAccount(userId)),
    );
    const drifted = results.filter((r) => !r.ok);
    res.json({
      total: accounts.length,
      driftedCount: drifted.length,
      drifted: drifted as ReconcileAccountResult[],
    });
  } catch (err) {
    next(err);
  }
}

export async function reconcileJobHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const jobId = req.query.jobId as string | undefined;
    if (!jobId) {
      next(Errors.badRequest("jobId query param required"));
      return;
    }
    const result = await reconcileJob(jobId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function sweep(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await sweepStuckHolds();
    res.json(result);
  } catch (err) {
    next(err);
  }
}
