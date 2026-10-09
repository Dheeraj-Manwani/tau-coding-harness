/**
 * Publishing a project: request a build, and read back where it went.
 *
 * The actual build lives in the worker (`worker/lib/deploy.ts`). This half owns
 * the two things that have to be decided before a build can start — the slug a
 * project is published under, and whether it is allowed to publish at all — plus
 * the read model the Publish panel renders, and the two ways the live pointer
 * moves without a build: rolling back and taking the site offline.
 */
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { withinRollbackWindow } from "../lib/deploySweep";
import { AppError, Errors } from "../lib/errors";
import { log } from "../lib/log";
import { enqueueJob } from "../lib/queue";
import { invalidateSiteLookup } from "../lib/siteLookup";
import * as projectRepo from "../repositories/project.repository";
import {
  isValidSlug,
  publicSiteUrl,
  sitePrefix,
  slugifyProjectName,
  slugWithSuffix,
} from "@/lib/sites";
import { TEMPLATES, toTemplateKey } from "@/worker/templates/registry";
import {
  DeploymentStatus,
  JobStatus,
  JobType,
} from "@/generated/prisma/enums";
import type { Deployment, Project } from "@/generated/prisma/client";

/** How many deployments the panel lists. Enough to see a history, not a log. */
const HISTORY_LIMIT = 10;

/** Attempts to find a free slug before giving up. Collisions are ~never. */
const SLUG_ATTEMPTS = 5;

export interface DeploymentSummary {
  id: string;
  status: DeploymentStatus;
  fileCount: number;
  sizeBytes: number;
  error: string | null;
  createdAt: Date;
  completedAt: Date | null;
  isLive: boolean;
  /**
   * This build can be put back in front of visitors: it went live once, its
   * files are still stored, and it is not the one serving now.
   */
  canRollback: boolean;
}

/** The newest publish, when it failed. */
export interface DeployFailure {
  error: string;
  /**
   * Tail of the build output, for "Fix with tau". Here rather than on every
   * summary row: it is kilobytes, and only the newest failure is acted on.
   */
  buildLog: string | null;
  /**
   * The project's files have changed since this build ran, so the error may
   * already be fixed and the thing to do is publish again.
   */
  changedSince: boolean;
}

export interface DeployStatus {
  slug: string | null;
  /** Null until the first publish allocates a slug. */
  url: string | null;
  live: DeploymentSummary | null;
  /** Most recent first, including the live one. */
  deployments: DeploymentSummary[];
  /** A publish is queued or building right now. */
  inProgress: boolean;
  /** Number of file changes since the live deployment was built. */
  unpublishedChanges: number;
  /**
   * Set when the project's template has a backend. Publishing ships the static
   * front-end only, so its API calls will 404 — say so before they click,
   * rather than letting them discover it on a live URL.
   */
  serverWarning: string | null;
  /**
   * Set when an admin has taken the site down. Publishing and rolling back are
   * refused until it is lifted; `reason` is what the owner is told.
   */
  suspended: { reason: string | null } | null;
  lastFailure: DeployFailure | null;
}

/** Statuses a deployment can only have after it went live at least once. */
const WENT_LIVE: DeploymentStatus[] = [
  DeploymentStatus.READY,
  DeploymentStatus.SUPERSEDED,
];

/**
 * Whether a deployment's files can still be served. A superseded build is only
 * restorable inside the window the sweep leaves it alone for
 * (`withinRollbackWindow`); a READY one is never swept at all.
 */
function isRestorable(deployment: Deployment): boolean {
  if (deployment.purgedAt || !WENT_LIVE.includes(deployment.status)) {
    return false;
  }
  return (
    deployment.status === DeploymentStatus.READY ||
    withinRollbackWindow(deployment)
  );
}

const SUSPENDED_MESSAGE =
  "This site has been suspended, so it can't be published or rolled back.";

function toSummary(
  deployment: Deployment,
  liveDeploymentId: string | null,
): DeploymentSummary {
  return {
    id: deployment.id,
    status: deployment.status,
    fileCount: deployment.fileCount,
    sizeBytes: deployment.sizeBytes,
    error: deployment.error,
    createdAt: deployment.createdAt,
    completedAt: deployment.completedAt,
    isLive: deployment.id === liveDeploymentId,
    canRollback:
      deployment.id !== liveDeploymentId && isRestorable(deployment),
  };
}

async function ownedProject(
  projectId: string,
  userId: string,
): Promise<Project> {
  const project = await projectRepo.findProjectById(projectId);
  if (!project) throw Errors.notFound("Project not found");
  if (project.userId !== userId) {
    throw Errors.forbidden("You do not have access to this project");
  }
  return project;
}

function serverWarningFor(templateKey: string): string | null {
  const template = TEMPLATES[toTemplateKey(templateKey)];
  if (!template.hasServer) return null;
  return template.hasDb
    ? "This project has a backend and a database. Publishing ships the front-end only — anything that calls the API or stores data won't work on the published site yet."
    : "This project has a backend. Publishing ships the front-end only — anything that calls the API won't work on the published site yet.";
}

export async function getDeployStatus(
  projectId: string,
  userId: string,
): Promise<DeployStatus> {
  const project = await ownedProject(projectId, userId);

  const deployments = await prisma.deployment.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take: HISTORY_LIMIT,
  });

  const live =
    deployments.find((d) => d.id === project.liveDeploymentId) ?? null;
  const newest = deployments[0];

  // Files touched since the live build was made — the same "is this stale?"
  // signal the GitHub panel shows for unpushed changes.
  const unpublishedChanges = live
    ? await prisma.projectFile.count({
        where: { projectId, lastSequence: { gt: live.sequence } },
      })
    : 0;

  return {
    slug: project.slug,
    url: project.slug ? publicSiteUrl(project.slug) : null,
    live: live ? toSummary(live, project.liveDeploymentId) : null,
    deployments: deployments.map((d) =>
      toSummary(d, project.liveDeploymentId),
    ),
    inProgress: deployments.some(
      (d) =>
        d.status === DeploymentStatus.QUEUED ||
        d.status === DeploymentStatus.BUILDING ||
        d.status === DeploymentStatus.UPLOADING,
    ),
    unpublishedChanges,
    serverWarning: serverWarningFor(project.templateKey),
    suspended: project.siteSuspendedAt
      ? { reason: project.siteSuspendedReason }
      : null,
    lastFailure:
      newest?.status === DeploymentStatus.FAILED
        ? {
            error: newest.error ?? "Publishing failed.",
            buildLog: newest.buildLog,
            changedSince: project.headSequence > newest.sequence,
          }
        : null,
  };
}

/**
 * Give the project a slug, once, and keep it.
 *
 * Allocated here rather than in the worker so the publish response can hand
 * back the final URL immediately — the user gets a link to watch instead of a
 * spinner that eventually reveals one. Retried on collision because the stem
 * comes from the project name and two "My Todo App"s are entirely likely; the
 * unique index, not this loop, is what actually guarantees uniqueness.
 */
async function ensureSlug(project: Project): Promise<string> {
  if (project.slug && isValidSlug(project.slug)) return project.slug;

  const stem = slugifyProjectName(project.name);

  for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt++) {
    const candidate = slugWithSuffix(stem, randomBytes(3).toString("hex"));
    try {
      const updated = await prisma.project.update({
        where: { id: project.id },
        data: { slug: candidate },
      });
      return updated.slug!;
    } catch {
      // Unique violation on `slug` — try another suffix. Any other failure
      // surfaces on the next attempt or as the error below.
    }
  }

  throw new AppError("Couldn't allocate a site address. Try again.", 500);
}

export interface RequestDeployResult {
  jobId: string;
  deploymentId: string;
  slug: string;
  url: string;
}

/**
 * Queue a DEPLOY job for the project's current files.
 *
 * The Deployment row is created in the same transaction as the Job so the two
 * can never exist apart: a job with no row would build with nowhere to write,
 * and a row with no job would sit QUEUED forever with nothing to run it.
 */
export async function requestDeploy(
  projectId: string,
  userId: string,
): Promise<RequestDeployResult> {
  const project = await ownedProject(projectId, userId);
  if (project.siteSuspendedAt) throw Errors.forbidden(SUSPENDED_MESSAGE);

  // A public URL on tau's domain is the one thing here an anonymous sign-up
  // could abuse at scale, so it needs an address that someone answers. The web
  // app already holds unverified accounts at its door; this is the same rule
  // for anything that calls the API directly.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { emailVerifiedAt: true },
  });
  if (!user?.emailVerifiedAt) {
    throw Errors.forbidden("Verify your email to publish.");
  }

  const fileCount = await prisma.projectFile.count({ where: { projectId } });
  if (fileCount === 0) {
    throw Errors.badRequest("Nothing to publish yet — build something first");
  }

  const slug = await ensureSlug(project);

  const { jobId, deploymentId } = await prisma.$transaction(
    async (tx) => {
      const active = await projectRepo.findActiveJob(projectId, tx);
      if (active) {
        throw active.type === JobType.DEPLOY
          ? Errors.conflict("A publish is already in progress")
          : Errors.conflict("generation in progress");
      }

      const job = await projectRepo.createJob(tx, {
        projectId,
        prompt: "",
        type: JobType.DEPLOY,
      });

      const deployment = await tx.deployment.create({
        data: {
          projectId,
          userId,
          jobId: job.id,
          // Placeholder: the prefix is keyed by the deployment's own id, which
          // the database assigns, so it can only be written after the insert.
          storagePrefix: "",
          sequence: project.headSequence,
        },
      });

      await tx.deployment.update({
        where: { id: deployment.id },
        data: {
          storagePrefix: sitePrefix(userId, projectId, deployment.id),
        },
      });

      return { jobId: job.id, deploymentId: deployment.id };
    },
    { isolationLevel: "Serializable" },
  );

  // No credit reserve: a publish runs a build, not the model. Consistent with
  // PREVIEW jobs, which are free for the same reason.
  const queueJobId = await enqueueJob({
    jobId,
    projectId,
    userId,
    prompt: "",
    effort: "LOW",
    type: JobType.DEPLOY,
  });
  await projectRepo.setJobQueueId(jobId, queueJobId);

  return { jobId, deploymentId, slug, url: publicSiteUrl(slug) };
}

/**
 * Put an earlier build back in front of visitors.
 *
 * No build runs and no bytes move: every deployment still owns its own prefix,
 * so this is the live pointer moving back and nothing else. The build it
 * replaces becomes a superseded one in turn, with a rollback window of its
 * own, so a rollback can itself be undone.
 *
 * Also how a site taken offline comes back without a rebuild: with nothing
 * live, the target simply becomes live.
 */
export async function rollbackDeploy(
  projectId: string,
  deploymentId: string,
  userId: string,
): Promise<DeployStatus> {
  await ownedProject(projectId, userId);

  const { slug, previousLiveId } = await prisma.$transaction(
    async (tx) => {
      // Same guard as a publish. A build in flight is about to move the
      // pointer itself, and an agent run is changing the files the user would
      // be comparing this version against.
      const active = await projectRepo.findActiveJob(projectId, tx);
      if (active) {
        throw active.type === JobType.DEPLOY
          ? Errors.conflict("A publish is already in progress")
          : Errors.conflict("generation in progress");
      }

      // Re-read inside the transaction: the pointer is what is being moved.
      const project = await tx.project.findUniqueOrThrow({
        where: { id: projectId },
        select: { liveDeploymentId: true, slug: true, siteSuspendedAt: true },
      });
      if (project.siteSuspendedAt) throw Errors.forbidden(SUSPENDED_MESSAGE);

      const target = await tx.deployment.findUnique({
        where: { id: deploymentId },
      });
      if (!target || target.projectId !== projectId) {
        throw Errors.notFound("That version isn't part of this project");
      }
      if (target.id === project.liveDeploymentId) {
        throw Errors.conflict("That version is already live");
      }
      if (!WENT_LIVE.includes(target.status)) {
        throw Errors.conflict(
          "Only a version that was published can be restored",
        );
      }
      const gone = Errors.conflict(
        "That version's files are no longer stored. Publish again instead.",
      );
      if (!isRestorable(target)) throw gone;

      if (project.liveDeploymentId) {
        await tx.deployment.updateMany({
          where: {
            id: project.liveDeploymentId,
            status: DeploymentStatus.READY,
          },
          data: {
            status: DeploymentStatus.SUPERSEDED,
            supersededAt: new Date(),
          },
        });
      }

      // Conditional on the row still being restorable, not just on its id: the
      // sweep claims a row by setting `purgedAt` before it deletes anything, so
      // if it got there between the read above and this write, nothing matches
      // and the pointer stays where it was.
      const restored = await tx.deployment.updateMany({
        where: { id: target.id, purgedAt: null, status: { in: WENT_LIVE } },
        data: { status: DeploymentStatus.READY, supersededAt: null },
      });
      if (restored.count === 0) throw gone;

      await tx.project.update({
        where: { id: projectId },
        data: { liveDeploymentId: target.id },
      });

      return { slug: project.slug, previousLiveId: project.liveDeploymentId };
    },
    { isolationLevel: "Serializable" },
  );

  if (slug) invalidateSiteLookup(slug);
  log.info("deploy.rollback", { projectId, deploymentId, previousLiveId });

  return getDeployStatus(projectId, userId);
}

/**
 * Take the published site offline.
 *
 * Clears the live pointer and nothing else. The address stays reserved for the
 * project, the history stays, and the build that was serving keeps its files
 * for the usual rollback window, so it can be put back without a rebuild.
 *
 * Allowed while suspended and while the agent is working: neither is a reason
 * to stop an owner taking their own site down.
 */
export async function unpublish(
  projectId: string,
  userId: string,
): Promise<DeployStatus> {
  await ownedProject(projectId, userId);

  const { slug, wasLiveId } = await prisma.$transaction(
    async (tx) => {
      // Only a publish blocks this: it would move the pointer straight back.
      const building = await tx.job.findFirst({
        where: {
          projectId,
          type: JobType.DEPLOY,
          status: { in: [JobStatus.QUEUED, JobStatus.RUNNING] },
        },
        select: { id: true },
      });
      if (building) {
        throw Errors.conflict(
          "A publish is in progress. Wait for it to finish, then take the site offline.",
        );
      }

      const project = await tx.project.findUniqueOrThrow({
        where: { id: projectId },
        select: { liveDeploymentId: true, slug: true },
      });
      // Already offline is not an error: the caller asked for a state, and it
      // is the state the project is in.
      if (!project.liveDeploymentId) {
        return { slug: project.slug, wasLiveId: null };
      }

      await tx.deployment.updateMany({
        where: { id: project.liveDeploymentId, status: DeploymentStatus.READY },
        data: {
          status: DeploymentStatus.SUPERSEDED,
          supersededAt: new Date(),
        },
      });
      await tx.project.update({
        where: { id: projectId },
        data: { liveDeploymentId: null },
      });

      return { slug: project.slug, wasLiveId: project.liveDeploymentId };
    },
    { isolationLevel: "Serializable" },
  );

  if (slug) invalidateSiteLookup(slug);
  if (wasLiveId) {
    log.info("deploy.unpublish", { projectId, deploymentId: wasLiveId });
  }

  return getDeployStatus(projectId, userId);
}
