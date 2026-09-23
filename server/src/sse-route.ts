import type { Express, Request, Response } from "express";
import { bus, type JobEvent } from "@/lib/bus";
import { verifyAccessToken } from "@/api/lib/tokens";
import { terminateStrandedJob } from "@/api/lib/jobs";
import { FinishReason, JobStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";

const HEARTBEAT_MS = 30_000;

/**
 * Narrow `:jobId` to a string.
 *
 * Express types a route param as possibly absent or repeated, and this file
 * only started being typechecked when phase 5 moved it out of `deploy/` and
 * into the service's tsconfig. Both handlers previously passed the unnarrowed
 * value straight into the bus.
 */
function jobIdOf(req: Request): string | null {
  const { jobId } = req.params;
  return typeof jobId === "string" && jobId !== "" ? jobId : null;
}

/**
 * Authenticate an SSE/cancel request. EventSource can't set an Authorization
 * header, so the access token arrives as a `?token=` query param (same as the
 * old WS gateway). Falls back to a Bearer header for the cancel POST, which the
 * web api-client sends normally.
 */
function authenticate(req: Request): { sub: string } | null {
  let token = typeof req.query.token === "string" ? req.query.token : "";
  if (!token) {
    const header = req.headers.authorization;
    if (header?.startsWith("Bearer ")) token = header.slice("Bearer ".length).trim();
  }
  if (!token) return null;
  try {
    return { sub: verifyAccessToken(token).sub };
  } catch {
    return null;
  }
}

/**
 * Economy replacement for the ws-gateway. Streams a job's events over SSE and
 * accepts a cancel POST, both over the api's single HTTP port and backed by the
 * in-process bus. Mounted via buildApp's `mountExtra` hook, before requireAuth.
 */
export function mountSse(app: Express): void {
  app.get("/jobs/:jobId/stream", async (req: Request, res: Response) => {
    const identity = authenticate(req);
    if (!identity) {
      res.status(401).end();
      return;
    }

    const jobId = jobIdOf(req);
    if (!jobId) {
      res.status(400).end();
      return;
    }
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      select: { project: { select: { userId: true } } },
    });
    if (!job || job.project.userId !== identity.sub) {
      res.status(404).end();
      return;
    }
    const raw = req.query.lastEventIndex;
    const parsed = typeof raw === "string" && raw !== "" ? Number(raw) : -1;
    const fromIndex = Number.isFinite(parsed) ? parsed : -1;

    res.status(200).set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // stop nginx/Render proxies from buffering
    });
    res.flushHeaders();

    const send = (e: JobEvent): void => {
      res.write(`id: ${e.index}\ndata: ${JSON.stringify(e)}\n\n`);
    };
    const unsub = bus.subscribe(jobId, fromIndex, send);

    const heartbeat = setInterval(() => res.write(`: hb\n\n`), HEARTBEAT_MS);

    req.on("close", () => {
      clearInterval(heartbeat);
      unsub();
      res.end();
    });
  });

  app.post("/jobs/:jobId/cancel", async (req: Request, res: Response) => {
    const identity = authenticate(req);
    if (!identity) {
      res.status(401).end();
      return;
    }
    const jobId = jobIdOf(req);
    if (!jobId) {
      res.status(400).end();
      return;
    }
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      select: { status: true, project: { select: { userId: true } } },
    });
    if (!job || job.project.userId !== identity.sub) {
      res.status(404).end();
      return;
    }
    if (job.status !== JobStatus.QUEUED && job.status !== JobStatus.RUNNING) {
      res.sendStatus(204);
      return;
    }

    // A resident job tears itself down: the runner's cancel handler flips the
    // row, settles the hold and emits `cancelled`.
    if (bus.isResident(jobId)) {
      bus.requestCancel(jobId);
      res.sendStatus(202);
      return;
    }

    // Nobody is running it. That used to make cancel a no-op returning 202 —
    // precisely useless for a job stranded by a restart, which is the only kind
    // a user ever needs to force-stop. Terminate the row here instead, recorded
    // as CANCELLED/CANCELLED: the user asked for this, so it is not a failure
    // and not an abandonment, even though the row was stranded when they did.
    await terminateStrandedJob(jobId, {
      status: JobStatus.CANCELLED,
      reason: FinishReason.CANCELLED,
      message: "This run was stopped because it was no longer running.",
    });
    res.sendStatus(202);
  });
}
