import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { parse } from "../lib/utils";
import {
  listHistoryQuerySchema,
  redeemCodeSchema,
  createPromoCodeSchema,
} from "../schemas/credits.schema";
import * as creditsService from "../services/credits.service";
import { requireUserId } from "../middleware/auth.middleware";
import { log } from "../lib/log";

export const getBalance = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = requireUserId(req);
    const result = await creditsService.getBalanceSummary(userId);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const getHistory = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = requireUserId(req);
    const { cursor, limit } = parse(listHistoryQuerySchema, req.query);
    const result = await creditsService.getHistory(userId, { cursor, limit });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

/** GET /credits/spend — building vs deployed-app AI, over the last 30 days. */
export const getSpend = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = await creditsService.getSpendSummary(requireUserId(req));
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const redeemCode = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = requireUserId(req);
    const { code } = parse(redeemCodeSchema, req.body);
    const result = await creditsService.redeemCode(userId, code);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const listPromoCodes = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    res.status(200).json(await creditsService.listPromoCodes());
  } catch (err) {
    next(err);
  }
};

const setPromoCodeActiveSchema = z.object({ isActive: z.boolean() });

export const setPromoCodeActive = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { isActive } = parse(setPromoCodeActiveSchema, req.body);
    const row = await creditsService.setPromoCodeActive(String(req.params.id), isActive);
    // requireAdmin logs who hit which path; this records the code by name.
    log.info(isActive ? "admin.promo.activate" : "admin.promo.deactivate", {
      userId: req.user?.id,
      code: row.code,
    });
    res.status(200).json(row);
  } catch (err) {
    next(err);
  }
};

export const createPromoCode = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const input = parse(createPromoCodeSchema, req.body);
    const result = await creditsService.createPromoCode(input);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
};
