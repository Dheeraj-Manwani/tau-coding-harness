import { Router } from "express";
import { createPromoCode } from "../controllers/credits.controller";
import { listFeedback } from "../services/feedback.service";
import { z } from "zod";
import { parse } from "../lib/utils";
import { renderAdminFeedback } from "../views/adminFeedback";
import {
  reconcileUser,
  reconcileAll,
  reconcileJobHandler,
  sweep,
  health,
  listJobs,
  jobDetail,
  jobEvents,
  metrics,
  sandboxes,
  userDetail,
  projectDetail,
  gatewayOverview,
  stream,
  killJob,
  reconcileStuckJobs,
  releaseHolds,
  destroySession,
  ui,
  costsUi,
  promoCodesUi,
  overview,
  errors,
  liveSandboxes,
  searchUsers,
  killSandbox,
} from "../controllers/admin.controller";

const router = Router();

router.get("/feedback/ui", (_req, res) => res.type("html").send(renderAdminFeedback()));

router.get("/feedback", async (req, res, next) => {
  try {
    const { cursor } = parse(z.object({ cursor: z.uuid().optional() }), req.query);
    res.json(await listFeedback(cursor));
  } catch (error) { next(error); }
});

router.get("/promo-codes", promoCodesUi);
router.post("/promo-codes", createPromoCode);

// ── credits reconciliation ───────────────────────────────────────────────────
router.get("/reconcile", reconcileUser); // ?userId=xxx
router.get("/reconcile/all", reconcileAll); // all accounts, returns drifted only
router.get("/reconcile/job", reconcileJobHandler); // ?jobId=xxx
router.post("/reconcile/sweep", sweep); // sweep stuck holds

// Session probe for the standalone console: who am I, if anyone.
router.get("/me", (req, res) => res.json({ id: req.user?.id, email: req.user?.email }));

// ── observability ────────────────────────────────────────────────────────────
router.get("/overview", overview); // the console's dashboard, cached 30s; ?fresh=1
router.get("/errors", errors); // grouped warn/error lines since process start
router.get("/health", health); // the one endpoint to page on
router.get("/metrics", metrics); // 1h / 24h / 7d rollups
router.get("/stream", stream); // SSE firehose of live job phases
router.get("/sandboxes", sandboxes); // ?check=true probes E2B
router.get("/sandboxes/live", liveSandboxes); // E2B list ⨝ projects; ?fresh=1
router.get("/jobs", listJobs); // ?status=&userId=&projectId=&since=&limit=
router.get("/jobs/:id", jobDetail);
router.get("/jobs/:id/events", jobEvents); // replay what the browser received
router.get("/users", searchUsers); // ?q=email fragment or id
router.get("/users/:id", userDetail);

// Runtime inference across every key — who is spending, on what. `?hours=`.
router.get("/gateway", gatewayOverview);
router.get("/projects/:id", projectDetail);

// ── incident tools ───────────────────────────────────────────────────────────
router.post("/jobs/reconcile-stuck", reconcileStuckJobs);
router.post("/jobs/:id/kill", killJob);
router.post("/users/:id/holds/release", releaseHolds);
router.post("/sandboxes/:id/kill", killSandbox); // orphans only — refuses anything owned

// ── console ──────────────────────────────────────────────────────────────────
router.get("/ui", ui);
router.get("/costs", costsUi);
router.post("/session/end", destroySession);

export default router;
