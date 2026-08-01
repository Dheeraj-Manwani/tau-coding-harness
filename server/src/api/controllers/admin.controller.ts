import type { Request, Response, NextFunction } from "express";
import { prisma } from "@/lib/prisma";
import {
  reconcileAccount,
  reconcileJob,
  sweepStuckHolds,
  type ReconcileAccountResult,
} from "@/lib/credits";
import { Errors } from "../lib/errors";
import { env } from "@/lib/env";
import { bus } from "@/lib/bus";
import { ADMIN_COOKIE, issueAdminSession } from "../middleware/admin.middleware";
import * as admin from "../services/admin.service";
import { renderAdminConsole } from "../views/adminConsole";

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

/**
 * Exchange `x-admin-key` for a short-lived HttpOnly cookie.
 *
 * A browser tab can't set a header on navigation, and stashing the raw admin key
 * in localStorage would leave a long-lived secret in browser storage. This is
 * mounted *before* `requireAdminKey` and does its own check.
 */
export const createSession = handler((req, res) => {
  const key = req.headers["x-admin-key"] ?? (req.body as { key?: string })?.key;
  if (!env.ADMIN_API_KEY || key !== env.ADMIN_API_KEY) {
    throw Errors.forbidden("Admin access required");
  }
  const { token, expiresAt } = issueAdminSession();
  res.cookie(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    expires: expiresAt,
    path: "/admin",
  });
  return { ok: true, expiresAt };
});

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

// ── incident tools ───────────────────────────────────────────────────────────

export const killJob = handler((req) => admin.killJob(String(req.params.id)));

export const reconcileStuckJobs = handler(() => admin.reconcileStuck());

export const releaseHolds = handler((req) =>
  admin.releaseUserHolds(String(req.params.id)),
);

// ── console ──────────────────────────────────────────────────────────────────

export function ui(_req: Request, res: Response): void {
  res.type("html").send(renderAdminConsole());
}

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
