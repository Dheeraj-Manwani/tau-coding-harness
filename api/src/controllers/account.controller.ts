import type { Request, Response, NextFunction } from "express";
import { requireUserId } from "../middleware/auth.middleware";
import * as accountService from "../services/account.service";

export async function getApiKey(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(await accountService.getApiKeyView(requireUserId(req)));
  } catch (err) {
    next(err);
  }
}

export async function createApiKey(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.status(201).json(await accountService.createApiKey(requireUserId(req)));
  } catch (err) {
    next(err);
  }
}

export async function revealApiKey(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(await accountService.revealApiKey(requireUserId(req)));
  } catch (err) {
    next(err);
  }
}

export async function rotateApiKey(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(await accountService.rotate(requireUserId(req)));
  } catch (err) {
    next(err);
  }
}

export async function revokeApiKeys(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(await accountService.revokeAll(requireUserId(req)));
  } catch (err) {
    next(err);
  }
}

export async function setDailyCap(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const raw = (req.body ?? {}).dailyCapCredits;
    // `null` explicitly means "go back to the default", which is different from
    // an absent field — so only undefined is a validation error.
    if (raw !== null && typeof raw !== "number") {
      res.status(400).json({
        error: "dailyCapCredits must be a number, or null to use the default",
      });
      return;
    }
    res.json(await accountService.setDailyCap(requireUserId(req), raw));
  } catch (err) {
    next(err);
  }
}
