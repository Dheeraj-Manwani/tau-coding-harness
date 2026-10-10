/**
 * What a plan may publish (doc/PUBLISHING.md C12, Phase 6). Enforced in tau's
 * server before a sandbox is spent; cloud budget alerts are only a delayed
 * backstop. Nothing here deletes anything: a refused publish leaves the live
 * site and its database as they are.
 */
import { Plan } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PublishLimits {
  /** Publishes that went live for one app in the last 24 hours. */
  publishesPerAppPerDay: number;
  /** Apps with a hosted backend that may be live at once. */
  backendApps: number;
}

export function publishLimits(plan: Plan): PublishLimits {
  return plan === Plan.FREE
    ? { publishesPerAppPerDay: env.PUBLISHES_PER_APP_PER_DAY_FREE, backendApps: env.BACKEND_APPS_FREE }
    : { publishesPerAppPerDay: env.PUBLISHES_PER_APP_PER_DAY_PRO, backendApps: env.BACKEND_APPS_PRO };
}

export interface QuotaInput {
  limits: PublishLimits;
  /** Builds of this app that went live in the last 24 hours. */
  publishesToday: number;
  /** This publish would put a hosted backend live. */
  needsBackend: boolean;
  /** Other apps of this owner that have a hosted backend live right now. */
  otherLiveBackends: number;
  /** This app already has a backend live, so it takes no new slot. */
  alreadyLiveBackend: boolean;
}

/** The sentence shown to the owner, or null when the publish may go ahead. */
export function quotaProblem(q: QuotaInput): string | null {
  if (q.publishesToday >= q.limits.publishesPerAppPerDay) {
    return `This app has been published ${q.publishesToday} times in the last 24 hours, which is the limit on your plan (${q.limits.publishesPerAppPerDay}). Try again later.`;
  }
  if (q.needsBackend && !q.alreadyLiveBackend && q.otherLiveBackends >= q.limits.backendApps) {
    return q.limits.backendApps === 1
      ? "Your plan can keep one app with a server live at a time, and you already have one. Take that app offline, or upgrade, to publish this one."
      : `Your plan can keep ${q.limits.backendApps} apps with a server live at a time, and you already have that many. Take one offline, or upgrade, to publish this one.`;
  }
  return null;
}

/** Reads what {@link quotaProblem} needs and returns its verdict. */
export async function publishQuotaProblem(args: {
  projectId: string;
  userId: string;
  plan: Plan;
  needsBackend: boolean;
}): Promise<string | null> {
  const { projectId, userId, plan, needsBackend } = args;

  // A build counts once it went live, whether or not it was replaced since: a
  // failed attempt cost no Lambda version and is held back by the per-user rate
  // limit on publishing instead.
  const publishesToday = await prisma.deployment.count({
    where: {
      projectId,
      status: { in: ["READY", "SUPERSEDED"] },
      completedAt: { gt: new Date(Date.now() - DAY_MS) },
    },
  });

  let otherLiveBackends = 0;
  let alreadyLiveBackend = false;
  if (needsBackend) {
    const live = await prisma.project.findMany({
      where: { userId, liveDeploymentId: { not: null } },
      select: { id: true, liveDeploymentId: true },
    });
    const withBackend = await prisma.deployment.findMany({
      where: { id: { in: live.map((p) => p.liveDeploymentId!) }, backendUrl: { not: null } },
      select: { projectId: true },
    });
    alreadyLiveBackend = withBackend.some((d) => d.projectId === projectId);
    otherLiveBackends = withBackend.filter((d) => d.projectId !== projectId).length;
  }

  return quotaProblem({
    limits: publishLimits(plan),
    publishesToday,
    needsBackend,
    otherLiveBackends,
    alreadyLiveBackend,
  });
}
