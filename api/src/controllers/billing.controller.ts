import type { Request, Response, NextFunction } from "express";
import {
  subscribeToPro,
  getSubscription,
  cancelSubscription,
  getPlans,
  getCreditPacks,
  createCreditOrder,
  verifyCreditPayment,
} from "../services/billing.service";
import { Errors } from "../lib/errors";

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw Errors.badRequest(`${field} is required`);
  }
  return value.trim();
}

export async function subscribe(req: Request, res: Response, next: NextFunction) {
  try {
    const { id: userId, email } = req.user!;
    const result = await subscribeToPro(userId, email);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function fetchSubscription(req: Request, res: Response, next: NextFunction) {
  try {
    const { id: userId } = req.user!;
    const sub = await getSubscription(userId);
    res.json({ subscription: sub });
  } catch (err) {
    next(err);
  }
}

export async function cancel(req: Request, res: Response, next: NextFunction) {
  try {
    const { id: userId } = req.user!;
    const result = await cancelSubscription(userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function plans(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(getPlans());
  } catch (err) {
    next(err);
  }
}

export async function creditPacks(
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    res.json(getCreditPacks());
  } catch (err) {
    next(err);
  }
}

export async function createCreditOrderHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const { id: userId } = req.user!;
    const packId = asString(req.body?.packId, "packId");
    const result = await createCreditOrder(userId, packId);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function verifyCreditPaymentHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const { id: userId } = req.user!;
    const orderId = asString(req.body?.orderId, "orderId");
    const paymentId = asString(req.body?.paymentId, "paymentId");
    const signature = asString(req.body?.signature, "signature");
    const result = await verifyCreditPayment(userId, {
      orderId,
      paymentId,
      signature,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}
