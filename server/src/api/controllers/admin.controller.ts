import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  reconcileAccount,
  reconcileJob,
  sweepStuckHolds,
  type ReconcileAccountResult,
} from "@/lib/credits";
import { Errors } from "../lib/errors";
import { parse } from "../lib/utils";
import { bus } from "@/lib/bus";
import { ADMIN_COOKIE } from "../middleware/admin.middleware";
import * as admin from "../services/admin.service";
import * as overviewService from "../services/adminOverview.service";
import { getCostSeed } from "../services/adminCosts.service";
import * as storageAdmin from "../services/storageAdmin.service";

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

const grantCreditsSchema = z.object({
  amountCredits: z.number().positive(),
  reason: z.string().trim().max(200).optional(),
});

/** POST /users/:id/credits/grant — manual top-up outside purchase/promo/plan. */
export const grantCredits = handler((req) => {
  const { amountCredits, reason } = parse(grantCreditsSchema, req.body);
  return admin.grantUserCredits(String(req.params.id), amountCredits, reason);
});

const setPlanSchema = z.object({ plan: z.enum(["FREE", "PRO"]) });

/** POST /users/:id/plan — manual plan comp, not a real Razorpay subscription. */
export const setPlan = handler((req) => {
  const { plan } = parse(setPlanSchema, req.body);
  return admin.setUserPlan(String(req.params.id), plan);
});

export const projectDetail = handler((req) =>
  admin.getProjectDetail(String(req.params.id)),
);

const suspendSiteSchema = z.object({
  reason: z.string().trim().min(1, "A reason is required").max(500),
});

/** POST /projects/:id/site/suspend — take a published site down for abuse. */
export const suspendSite = handler((req) => {
  const { reason } = parse(suspendSiteSchema, req.body);
  return admin.suspendProjectSite(String(req.params.id), reason);
});

/** POST /projects/:id/site/unsuspend — put it back exactly as it was. */
export const unsuspendSite = handler((req) =>
  admin.unsuspendProjectSite(String(req.params.id)),
);

// ── file storage ─────────────────────────────────────────────────────────────

const storageEnvSchema = z.enum(["PREVIEW", "LIVE"]).default("PREVIEW");
const adminId = (req: Request) => req.user?.id ?? "unknown";

/** GET /storage — what is stored, by whom, and who is near their allowance. */
export const storageOverview = handler(() => storageAdmin.overview());

/** GET /projects/:id/storage/files — any project's files, even while suspended. */
export const storageFiles = handler((req) => {
  const q = parse(
    z.object({
      env: storageEnvSchema,
      prefix: z.string().max(512).optional(),
      cursor: z.string().max(512).optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
    }),
    req.query,
  );
  const { env, ...rest } = q;
  return storageAdmin.listFiles(String(req.params.id), env, rest);
});

/** POST /projects/:id/storage/suspend — no uploads or addresses; files are kept. */
export const suspendStorage = handler((req) => {
  const { reason } = parse(suspendSiteSchema, req.body);
  return storageAdmin.suspendStorage(String(req.params.id), adminId(req), reason);
});

export const resumeStorage = handler((req) => storageAdmin.resumeStorage(String(req.params.id), adminId(req)));

/** POST /projects/:id/storage/files/delete — takedown of one file; a reason is required. */
export const deleteStorageFile = handler((req) => {
  const body = parse(
    z.object({ env: storageEnvSchema, key: z.string().min(1).max(512), reason: z.string().trim().min(1, "A reason is required").max(500) }),
    req.body,
  );
  return storageAdmin.deleteFile(String(req.params.id), body.env, body.key, adminId(req), body.reason);
});

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
