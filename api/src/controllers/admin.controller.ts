import type { Request, Response, NextFunction } from "express";
import { prisma } from "../lib/prisma";
import {
  reconcileAccount,
  reconcileJob,
  sweepStuckHolds,
  type ReconcileAccountResult,
} from "../lib/credits";
import { Errors } from "../lib/errors";

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
