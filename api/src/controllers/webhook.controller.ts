import type { Request, Response, NextFunction } from "express";
import { processRazorpayWebhook } from "../services/billing.service";
import { Errors } from "../lib/errors";

export async function razorpayWebhook(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const signature = req.headers["x-razorpay-signature"];
    const eventId = req.headers["x-razorpay-event-id"];

    if (typeof signature !== "string" || !signature) {
      return next(Errors.badRequest("Missing x-razorpay-signature header"));
    }
    if (typeof eventId !== "string" || !eventId) {
      return next(Errors.badRequest("Missing x-razorpay-event-id header"));
    }

    // req.body is a raw Buffer
    const rawBody = req.body as Buffer;
    await processRazorpayWebhook(rawBody, signature, eventId);

    res.sendStatus(200);
  } catch (err) {
    next(err);
  }
}
