/**
 * Publishing a project: request a build, and read back where it went.
 *
 * The actual build lives in the worker (`worker/lib/deploy.ts`). This half owns
 * the two things that have to be decided before a build can start — the slug a
 * project is published under, and whether it is allowed to publish at all — plus
 * the read model the Publish panel renders.
 */
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { AppError, Errors } from "../lib/errors";
import { enqueueJob } from "../lib/queue";
import * as projectRepo from "../repositories/project.repository";
import {
  isValidSlug,
  publicSiteUrl,
  sitePrefix,
  slugifyProjectName,
  slugWithSuffix,
} from "@/lib/sites";
import { TEMPLATES, toTemplateKey } from "@/worker/templates/registry";
import { DeploymentStatus, JobType } from "@/generated/prisma/enums";
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
}

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
