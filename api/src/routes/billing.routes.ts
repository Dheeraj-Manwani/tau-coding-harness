import { Router } from "express";
import {
  subscribe,
  fetchSubscription,
  cancel,
  plans,
  creditPacks,
  createCreditOrderHandler,
  verifyCreditPaymentHandler,
} from "../controllers/billing.controller";

const router = Router();

router.get("/plans", plans);
router.post("/subscribe", subscribe);
router.get("/subscription", fetchSubscription);
router.post("/cancel", cancel);

// Pay-as-you-go credit top-ups.
router.get("/credits/packs", creditPacks);
router.post("/credits/order", createCreditOrderHandler);
router.post("/credits/verify", verifyCreditPaymentHandler);

export default router;
