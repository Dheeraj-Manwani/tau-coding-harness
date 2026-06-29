import type { NextFunction, Request, Response } from "express";
import { parse } from "../lib/utils";
import {
  listHistoryQuerySchema,
  redeemCodeSchema,
  createPromoCodeSchema,
} from "../schemas/credits.schema";
import * as creditsService from "../services/credits.service";
import { requireUserId } from "../middleware/auth.middleware";

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
