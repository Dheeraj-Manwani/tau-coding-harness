/**
 * Put a project's current secrets into its live server without a rebuild
 * (doc/PUBLISHING.md C7).
 *
 * A published function's environment is fixed when a version is made, so a secret
 * the owner added or changed after publishing, or a rotated tau key, only reaches
 * the live app through here or through the next publish. The code is untouched:
 * `refreshBackendEnv` re-publishes the live version's own code with the new
 * environment and moves the live alias to it.
 */
import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/log";
import { backendHostingAvailable, refreshBackendEnv } from "@/lib/lambdaApps";
import { getDatabaseUrl } from "@/lib/neonApps";
import { buildPublishEnv } from "@/worker/lib/deployFullstack";
import { DeploymentStatus } from "@/generated/prisma/enums";
import { IN_FLIGHT_DEPLOYMENT_STATUSES } from "@/lib/deployStatus";

const { log } = createLogger("refresh-secrets");

export type RefreshOutcome =
  | { status: "refreshed" }
  | { status: "skipped"; reason: "no_backend" | "publish_in_progress" | "hosting_off" };

/** Refreshes one project's live server. Throws when AWS or the environment is the problem. */
export async function refreshLiveBackend(projectId: string): Promise<RefreshOutcome> {
  if (!backendHostingAvailable()) return { status: "skipped", reason: "hosting_off" };

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { userId: true, aiEnabled: true, storageEnabled: true, liveDeploymentId: true },
  });
  const live = project?.liveDeploymentId
    ? await prisma.deployment.findUnique({
        where: { id: project.liveDeploymentId },
        select: { id: true, backendUrl: true, schemaSql: true, status: true },
      })
    : null;
  if (!project || !live?.backendUrl || live.status !== DeploymentStatus.READY) return { status: "skipped", reason: "no_backend" };

  // A publish updates the same function; two at once would race on its settings.
  const inFlight = await prisma.deployment.count({
    where: { projectId, status: { in: IN_FLIGHT_DEPLOYMENT_STATUSES } },
  });
  if (inFlight > 0) return { status: "skipped", reason: "publish_in_progress" };

  const { vars } = await buildPublishEnv({ userId: project.userId, projectId, jobId: "refresh", aiEnabled: project.aiEnabled, storageEnabled: project.storageEnabled });
  // A database app keeps the connection string it was published with.
  if (live.schemaSql !== null) {
    const url = await getDatabaseUrl(projectId);
    if (url) vars.DATABASE_URL = url;
  }
  await refreshBackendEnv({ projectId, deploymentId: live.id, env: vars });
  return { status: "refreshed" };
}

/**
 * After a tau key is rotated: every live server of that user that uses the AI
 * gateway gets the new key, well inside the old key's grace window. Failures are
 * logged and do not stop the others, and none of them reaches the person who
 * rotated: the old key keeps working for its grace period, and the panel's
 * "Refresh secrets" is the manual way.
 */
export async function refreshUserBackends(userId: string): Promise<{ refreshed: number; failed: number }> {
  const projects = await prisma.project.findMany({
    where: { userId, aiEnabled: true, liveDeploymentId: { not: null } },
    select: { id: true },
  });
  let refreshed = 0;
  let failed = 0;
  for (const { id } of projects) {
    try {
      const out = await refreshLiveBackend(id);
      if (out.status === "refreshed") refreshed += 1;
    } catch (err) {
      failed += 1;
      log.warn("refresh.failed", { projectId: id, error: String(err).slice(0, 200) });
    }
  }
  if (projects.length > 0) log.info("refresh.after_rotation", { userId, refreshed, failed });
  return { refreshed, failed };
}
