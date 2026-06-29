import type { Request, Response, NextFunction } from "express";
import {
  subscribeToPro,
  getSubscription,
  cancelSubscription,
  getPlans,
} from "../services/billing.service";

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
