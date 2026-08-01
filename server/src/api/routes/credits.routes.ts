import { Router } from "express";
import {
  getBalance,
  getHistory,
  getSpend,
  redeemCode,
} from "../controllers/credits.controller";

const router = Router();

router.get("/balance", getBalance);
router.get("/history", getHistory);
router.get("/spend", getSpend);
router.post("/redeem", redeemCode);

export default router;
