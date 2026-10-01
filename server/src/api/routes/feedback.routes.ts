import { Router } from "express";
import { requireUserId } from "../middleware/auth.middleware";
import { feedbackRateLimiter } from "../middleware/rateLimit.middleware";
import { parse } from "../lib/utils";
import { feedbackSchema } from "../schemas/feedback.schema";
import { submitFeedback } from "../services/feedback.service";

const router = Router();
router.post("/", feedbackRateLimiter, async (req, res, next) => {
  try {
    res.status(201).json(await submitFeedback(requireUserId(req), parse(feedbackSchema, req.body)));
  } catch (error) { next(error); }
});
export default router;
