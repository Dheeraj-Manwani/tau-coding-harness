/**
 * Publishing a project: request a build, and read back where it went.
 *
 * The actual build lives in the worker (`worker/lib/deploy.ts`). This half owns
 * the two things that have to be decided before a build can start — the slug a
 * project is published under, and whether it is allowed to publish at all — plus
 * the read model the Publish panel renders, and the two ways the live pointer
 * moves without a build: rolling back and taking the site offline.
 */
import { createHash, randomBytes } from "node:crypto";
import { backendHostingAvailable, recentBackendLogs } from "@/lib/lambdaApps";
import { getDatabaseUrl } from "@/lib/neonApps";
import { exportDatabase } from "@/lib/databaseExport";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { refreshLiveBackend } from "@/lib/refreshSecrets";
import { ensureBillingAccount, getBalance } from "@/lib/credits";
import { publishQuotaProblem } from "@/lib/deployQuota";
import { PUBLISH_FEE_MICRO, toCredits } from "@/lib/pricing";
import { withinRollbackWindow } from "../lib/deploySweep";
import { isInFlight } from "@/lib/deployStatus";
import { AppError, Errors } from "../lib/errors";
import { log } from "../lib/log";
import { enqueueJob } from "../lib/queue";
import { invalidateSiteLookup } from "../lib/siteLookup";
import { syncProject } from "@/lib/edgeRegistry";
import * as projectRepo from "../repositories/project.repository";
import {
  checkSiteName,
  isValidSlug,
  publicSiteUrl,
  sitePrefix,
  slugifyProjectName,
  slugWithSuffix,
} from "@/lib/sites";
import { TEMPLATES, toTemplateKey } from "@/worker/templates/registry";
import {
  DeploymentStatus,
  DomainStatus,
  JobStatus,
  JobType,
  ResourceKind,
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
   * Set when the publish stopped because the database structure changed in a way
   * that cannot be applied automatically: what changed, for the owner to confirm.
   */
  schemaChanges: { kind: string; message: string }[] | null;
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
  /**
   * What the Publish panel offers as the address before the first publish, and
   * null once it is fixed. Free at the time of asking, not reserved.
   */
  suggestedName: string | null;
  /** The sites domain (bytauai.pro), or null where sites are served by path. */
  domain: string | null;
  /** The custom domain the app lives at, when one is active and primary. */
  primaryUrl: string | null;
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
  /**
   * The one-time price of a project's first publish. `due` is false once it has
   * been paid, and a project that was live before the fee existed counts as
   * paid. Updates, rollbacks and take-offline never cost anything.
   */
  publishFee: { credits: number; due: boolean };
  /** The app has its own published database, so its data can be exported. */
  databasePublished: boolean;
  /** The live version has a hosted server, so its recent log lines can be read. */
  backendPublished: boolean;
  /** The published app has its own file storage (a live storage key exists). */
  storagePublished: boolean;
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
  if (backendHostingAvailable()) {
    // The server is published too. A database is the part that is not yet.
    return template.hasDb
      ? "This project has a database, and publishing a database isn't available yet. Publishing will stop and tell you so; your preview is unaffected."
      : null;
  }
  return template.hasDb
    ? "This project has a backend and a database. Publishing ships the front-end only — anything that calls the API or stores data won't work on the published site yet."
    : "This project has a backend. Publishing ships the front-end only — anything that calls the API won't work on the published site yet.";
}

/** `https://{hostname}` of the project's active primary domain, if it has one. */
async function primaryUrlOf(projectId: string): Promise<string | null> {
  const primary = await prisma.domain.findFirst({
    where: { projectId, isPrimary: true, status: DomainStatus.ACTIVE },
    select: { hostname: true },
  });
  return primary ? `https://${primary.hostname}` : null;
}

/** The owner's published data as a zip (doc/PUBLISHING.md 5.7). */
export async function exportPublishedData(projectId: string, userId: string): Promise<Uint8Array> {
  const project = await ownedProject(projectId, userId);
  const url = await getDatabaseUrl(projectId);
  if (!url) throw Errors.notFound("This project has no published database.");
  const live = project.liveDeploymentId
    ? await prisma.deployment.findUnique({ where: { id: project.liveDeploymentId }, select: { schemaSql: true } })
    : null;
  try {
    return (await exportDatabase(url, live?.schemaSql ?? null)).zip;
  } catch (err) {
    if (err instanceof Error && err.message.includes("too large")) throw Errors.badRequest(err.message);
    throw new AppError("The database could not be reached. Try again in a minute.", 503);
  }
}

/**
 * Put the project's current secrets into its live server now, without a rebuild.
 */
export async function refreshSecretsNow(projectId: string, userId: string): Promise<{ refreshed: true }> {
  await ownedProject(projectId, userId);
  const out = await refreshLiveBackend(projectId);
  if (out.status === "skipped") {
    throw out.reason === "publish_in_progress"
      ? Errors.conflict("A publish is in progress. Its result will include your latest secrets.")
      : Errors.badRequest("This app has no hosted server to refresh.");
  }
  return { refreshed: true };
}

const LOG_WINDOW_MS = 60 * 60 * 1000;

/**
 * What the live app's server printed in the last hour, with secrets masked.
 * `available` is false when the app has no hosted backend to read from.
 */
export async function getPublishedLogs(
  projectId: string,
  userId: string,
): Promise<{ available: boolean; logs: string; sinceMinutes: number }> {
  const project = await ownedProject(projectId, userId);
  const live = project.liveDeploymentId
    ? await prisma.deployment.findUnique({ where: { id: project.liveDeploymentId }, select: { backendUrl: true } })
    : null;
  const sinceMinutes = LOG_WINDOW_MS / 60_000;
  if (!live?.backendUrl || !backendHostingAvailable()) return { available: false, logs: "", sinceMinutes };
  return { available: true, logs: await recentBackendLogs(projectId, Date.now() - LOG_WINDOW_MS), sinceMinutes };
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
    suggestedName: project.slug ? null : await suggestName(project),
    domain: env.SITES_DOMAIN ?? null,
    primaryUrl: await primaryUrlOf(projectId),
    live: live ? toSummary(live, project.liveDeploymentId) : null,
    deployments: deployments.map((d) =>
      toSummary(d, project.liveDeploymentId),
    ),
    inProgress: deployments.some((d) => isInFlight(d.status)),
    unpublishedChanges,
    serverWarning: serverWarningFor(project.templateKey),
    backendPublished: !!live?.backendUrl,
    databasePublished:
      (await prisma.projectResource.count({
        where: { projectId, kind: ResourceKind.NEON_PROJECT, deletedAt: null },
      })) > 0,
    storagePublished: project.storageEnabled
      ? (await prisma.storageKey.count({ where: { projectId, env: "LIVE" } })) > 0
      : false,
    publishFee: {
      credits: toCredits(PUBLISH_FEE_MICRO),
      due: project.publishFeePaidAt === null,
    },
    suspended: project.siteSuspendedAt
      ? { reason: project.siteSuspendedReason }
      : null,
    lastFailure:
      newest?.status === DeploymentStatus.FAILED
        ? {
            error: newest.error ?? "Publishing failed.",
            buildLog: newest.buildLog,
            schemaChanges: Array.isArray(newest.schemaChanges)
              ? (newest.schemaChanges as { kind: string; message: string }[])
              : null,
            changedSince: project.headSequence > newest.sequence,
          }
        : null,
  };
}

export type NameProblem = "invalid" | "reserved" | "taken";

const NAME_MESSAGES: Record<NameProblem, string> = {
  invalid:
    "Use 3 to 40 letters, numbers and hyphens, and do not start or end with a hyphen.",
  reserved: "That name is reserved. Choose another.",
  taken: "That name is taken. Choose another.",
};

/** Whether `name` could be this project's address right now. */
async function problemWith(
  name: string,
  projectId: string,
): Promise<NameProblem | null> {
  const checked = checkSiteName(name);
  if (!checked.ok) return checked.problem;
  const claimed = await prisma.siteName.findUnique({
    where: { name: checked.name },
    select: { projectId: true },
  });
  return claimed && claimed.projectId !== projectId ? "taken" : null;
}

/**
 * Whether a name can be chosen as an app's address, for the panel's live check.
 *
 * Says nothing about who holds a taken name. Once a project has its address it
 * is fixed, and the answer is that it is `locked`.
 */
export async function checkNameAvailable(
  projectId: string,
  userId: string,
  rawName: string,
) {
  const project = await ownedProject(projectId, userId);
  const name = rawName.trim().toLowerCase();
  if (project.slug) {
    return {
      name,
      available: false,
      locked: true,
      problem: null,
      message: "This project's address is fixed.",
    };
  }
  const problem = await problemWith(name, projectId);
  return {
    name,
    available: problem === null,
    locked: false,
    problem,
    message: problem ? NAME_MESSAGES[problem] : null,
  };
}

/**
 * The address offered before the first publish: the project's own name if it is
 * free, otherwise the name with a short code that is the same on every call (so
 * the panel does not shuffle it), otherwise a random one.
 */
async function suggestName(project: Project): Promise<string> {
  const stem = slugifyProjectName(project.name);
  const fixed = slugWithSuffix(
    stem,
    createHash("sha256").update(project.id).digest("hex").slice(0, 6),
  );
  for (const candidate of [stem, fixed]) {
    if ((await problemWith(candidate, project.id)) === null) return candidate;
  }
  return slugWithSuffix(stem, randomBytes(3).toString("hex"));
}

/** Claim a name for the project for good: the claim and the slug land together or not at all. */
async function claim(project: Project, name: string): Promise<boolean> {
  try {
    await prisma.$transaction(async (tx) => {
      await tx.siteName.create({ data: { name, projectId: project.id } });
      await tx.project.update({ where: { id: project.id }, data: { slug: name } });
    });
    return true;
  } catch (err) {
    // The unique index, not the check before it, is what decides a race.
    if ((err as { code?: string }).code === "P2002") return false;
    throw err;
  }
}

/**
 * Give the project its address, once, and keep it.
 *
 * Allocated here rather than in the worker so the publish response can hand
 * back the final URL immediately: the owner gets a link to watch instead of a
 * spinner that eventually reveals one. A name they chose is claimed as asked or
 * refused; with none, the suggestion is claimed, retrying with a random suffix
 * on collision. A claim is permanent (`SiteName`): the name is never offered to
 * anyone else, even after the project is deleted.
 */
async function ensureSlug(project: Project, requested?: string): Promise<string> {
  if (project.slug && isValidSlug(project.slug)) {
    if (requested && requested.trim().toLowerCase() !== project.slug) {
      throw Errors.conflict("This project's address is already fixed and cannot be changed.");
    }
    return project.slug;
  }

  if (requested) {
    const checked = checkSiteName(requested);
    if (!checked.ok) throw Errors.badRequest(NAME_MESSAGES[checked.problem]);
    if (!(await claim(project, checked.name))) {
      throw Errors.conflict(NAME_MESSAGES.taken);
    }
    return checked.name;
  }

  const stem = slugifyProjectName(project.name);
  const first = await suggestName(project);
  if ((await problemWith(first, project.id)) === null && (await claim(project, first))) {
    return first;
  }
  for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt++) {
    const candidate = slugWithSuffix(stem, randomBytes(3).toString("hex"));
    if (checkSiteName(candidate).ok && (await claim(project, candidate))) return candidate;
  }

  throw new AppError("Could not allocate a site address. Try again.", 500);
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
  name?: string,
  confirmSchemaChange = false,
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

  // Nothing is charged here: the fee is taken when the first build goes live, so
  // a failed one costs nothing. This only refuses a publish that could not pay,
  // before a sandbox is spent building it.
  if (project.publishFeePaidAt === null && env.CREDITS_ENFORCE) {
    const { available } = await getBalance(userId);
    if (available < PUBLISH_FEE_MICRO) {
      throw Errors.paymentRequired(
        `Publishing a project for the first time costs ${toCredits(PUBLISH_FEE_MICRO)} credits. You have ${Math.floor(toCredits(available))}.`,
      );
    }
  }

  const fileCount = await prisma.projectFile.count({ where: { projectId } });
  if (fileCount === 0) {
    throw Errors.badRequest("Nothing to publish yet — build something first");
  }

  // Plan limits (C12). Refused before a sandbox is spent; nothing is deleted.
  if (env.PUBLISH_QUOTAS_ENFORCE) {
    const { plan } = await ensureBillingAccount(userId);
    const problem = await publishQuotaProblem({
      projectId,
      userId,
      plan,
      needsBackend: backendHostingAvailable() && TEMPLATES[toTemplateKey(project.templateKey)].hasServer,
    });
    if (problem) throw Errors.tooMany(problem);
  }

  const slug = await ensureSlug(project, name);

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
          confirmSchemaChange,
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
  await syncProject(projectId);
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
  await syncProject(projectId);
  if (wasLiveId) {
    log.info("deploy.unpublish", { projectId, deploymentId: wasLiveId });
  }

  return getDeployStatus(projectId, userId);
}
