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
 *   - superseded builds for {@link SUPERSEDED_RETENTION_DAYS} after they
 *     stopped serving, so there is a window in which a previous version can be
 *     restored. Counted from `supersededAt`, not from when the build finished:
 *     a build that was live for a month is still a week from being purged on
 *     the day it is replaced;
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

/**
 * Is a superseded deployment still inside its rollback window?
 *
 * The sweep and rollback share this one rule on purpose. The sweep only takes
 * rows it is false for and a rollback only accepts rows it is true for, so a
 * build whose bytes are being deleted, or were half deleted by a pass that
 * failed, can never be put back in front of visitors.
 *
 * Rows superseded before `supersededAt` existed have nothing better to go on
 * than when they were built.
 */
export function withinRollbackWindow(
  deployment: { supersededAt: Date | null; completedAt: Date | null },
  now: number = Date.now(),
): boolean {
  const since = deployment.supersededAt ?? deployment.completedAt;
  return !!since && since.getTime() >= now - SUPERSEDED_RETENTION_DAYS * DAY_MS;
}

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

  const supersededBefore = new Date(now - SUPERSEDED_RETENTION_DAYS * DAY_MS);

  const candidates = await prisma.deployment.findMany({
    where: {
      purgedAt: null,
      OR: [
        {
          status: DeploymentStatus.SUPERSEDED,
          supersededAt: { lt: supersededBefore },
        },
        // The fallback in `withinRollbackWindow`.
        {
          status: DeploymentStatus.SUPERSEDED,
          supersededAt: null,
          completedAt: { lt: supersededBefore },
        },
        {
          status: DeploymentStatus.FAILED,
          completedAt: { lt: new Date(now - FAILED_RETENTION_DAYS * DAY_MS) },
        },
      ],
    },
    select: { id: true, storagePrefix: true },
    orderBy: { completedAt: "asc" },
    take: BATCH,
  });

  for (const deployment of candidates) {
    // Claim the row before touching its bytes. A rollback that started a moment
    // before the window closed may still be committing, and it only accepts a
    // row whose `purgedAt` is null: so once this update lands the row can no
    // longer go live, and if the rollback got there first the status no longer
    // matches and there is nothing to claim. Either way a live site never
    // loses its bytes.
    const claimed = await prisma.deployment.updateMany({
      where: {
        id: deployment.id,
        purgedAt: null,
        status: { in: [DeploymentStatus.SUPERSEDED, DeploymentStatus.FAILED] },
      },
      data: { purgedAt: new Date() },
    });
    if (claimed.count === 0) continue;

    try {
      if (deployment.storagePrefix) {
        objectsDeleted += await deleteSitePrefix(deployment.storagePrefix);
      }
      purged += 1;
    } catch (err) {
      // Hand the row back so the next pass retries: an R2 blip should not
      // strand the objects permanently. It is outside the rollback window, so
      // being unclaimed again does not make it restorable.
      await prisma.deployment
        .update({ where: { id: deployment.id }, data: { purgedAt: null } })
        .catch(() => {});
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
