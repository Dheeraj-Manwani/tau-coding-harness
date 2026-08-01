/**
 * Reclaim the R2 objects behind deployments nobody can reach any more.
 *
 * Every publish writes a full copy of the build to its own prefix, which is
 * what makes publishing atomic and rollback free — and also what makes storage
 * grow without limit if nothing ever cleans up. A user who publishes twenty
 * times leaves nineteen dead bundles on tau's bill.
 *
 * What survives:
 *   - the live deployment, always, whatever its age;
 *   - superseded builds for {@link SUPERSEDED_RETENTION_DAYS}, so there is a
 *     window in which the previous version can be restored;
 *   - failed builds for {@link FAILED_RETENTION_DAYS}, only long enough for
 *     someone to read the error.
 *
 * The row itself is never deleted — it is the record of what was published.
 * Only its bytes go, and `purgedAt` marks that so the next pass skips it rather
 * than re-listing an empty prefix forever.
 */
import { prisma } from "@/lib/prisma";
import { deleteSitePrefix } from "@/lib/s3";
import { DeploymentStatus } from "@/generated/prisma/enums";
import { captureException, log } from "./log";

const SUPERSEDED_RETENTION_DAYS = 7;
const FAILED_RETENTION_DAYS = 1;

/** Bounded so one pass cannot turn into thousands of R2 calls. */
const BATCH = 50;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DeploySweepResult {
  purged: number;
  objectsDeleted: number;
  errors: string[];
}

export async function sweepDeployments(): Promise<DeploySweepResult> {
  const now = Date.now();
  const errors: string[] = [];
  let purged = 0;
  let objectsDeleted = 0;

  const candidates = await prisma.deployment.findMany({
    where: {
      purgedAt: null,
      OR: [
        {
          status: DeploymentStatus.SUPERSEDED,
          completedAt: {
            lt: new Date(now - SUPERSEDED_RETENTION_DAYS * DAY_MS),
          },
        },
        {
          status: DeploymentStatus.FAILED,
          completedAt: { lt: new Date(now - FAILED_RETENTION_DAYS * DAY_MS) },
        },
      ],
    },
    select: { id: true, projectId: true, storagePrefix: true },
    orderBy: { completedAt: "asc" },
    take: BATCH,
  });

  for (const deployment of candidates) {
    // Belt and braces against the one outcome that would actually hurt: a live
    // site losing its bytes. The status filter above should already exclude it,
    // but a race with a publish that moved the pointer is cheap to rule out.
    const project = await prisma.project.findUnique({
      where: { id: deployment.projectId },
      select: { liveDeploymentId: true },
    });
    if (project?.liveDeploymentId === deployment.id) continue;

    try {
      if (deployment.storagePrefix) {
        objectsDeleted += await deleteSitePrefix(deployment.storagePrefix);
      }
      await prisma.deployment.update({
        where: { id: deployment.id },
        data: { purgedAt: new Date() },
      });
      purged += 1;
    } catch (err) {
      // Leave purgedAt null so the next pass retries — an R2 blip should not
      // strand the objects permanently.
      errors.push(`${deployment.id}: ${String(err)}`);
    }
  }

  return { purged, objectsDeleted, errors };
}

/** Hourly entry point, mirroring the other sweeps in `api/index.ts`. */
export async function runDeploySweep(): Promise<void> {
  try {
    const { purged, objectsDeleted, errors } = await sweepDeployments();
    if (purged > 0 || errors.length > 0) {
      log.info("deploys.sweep", { purged, objectsDeleted, errors });
    }
  } catch (err) {
    captureException(err, { detail: "deployment sweep failed" });
  }
}
