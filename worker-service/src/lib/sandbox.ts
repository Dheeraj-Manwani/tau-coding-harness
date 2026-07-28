import { createHash } from "crypto";
import { Sandbox } from "e2b";
import { prisma } from "./prisma";
import { bus } from "./bus";
import { env } from "./env";
import { getBlob, getBlobText, putBlob } from "./s3";
import {
  isBinaryPath,
  isSecretPath,
  toRelativePath,
} from "../agent/tools/functions/utils";
import { publish } from "./publish";
import { log } from "./log";
import { allocateHeadSequence } from "./headSequence";
import { SandboxStatus } from "../generated/prisma/enums";
import {
  e2bNameFor,
  toTemplateKey,
  type TemplateKey,
} from "../templates/registry";

export type { Sandbox } from "e2b";

export const WORK_DIR = "/home/user/app";

export const SANDBOX_IDLE_TIMEOUT_MS = 10 * 60_000;

const PROVISION_GRACE_WINDOW_MS = 30_000;

function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

export function getSandbox(sandboxId: string): Promise<Sandbox> {
  return Sandbox.connect(sandboxId, {
    timeoutMs: SANDBOX_IDLE_TIMEOUT_MS,
  });
}

async function verifySandboxAlive(sandbox: Sandbox): Promise<void> {
  await sandbox.commands.run("true", { timeoutMs: PROVISION_GRACE_WINDOW_MS });
}

async function seedTemplateFiles(
  sandbox: Sandbox,
  projectId: string,
  userId: string,
  jobId: string,
): Promise<void> {
  const { stdout } = await sandbox.commands.run(
    `find ${WORK_DIR} -type f -not -path '*/node_modules/*' -not -path '*/.git/*'`,
  );

  // This path writes ProjectFile rows directly rather than going through
  // `persistFile`, so it has to apply the secret deny-list itself. Nothing in
  // the templates writes a credentials file today, but the seed is a `find` over
  // whatever the image happens to contain — belt and braces.
  const absPaths = stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .filter((p) => !isSecretPath(toRelativePath(p)));
  if (absPaths.length === 0) return;

  log.info("sandbox.seed.start", { jobId, projectId, files: absPaths.length });

  const BATCH = 10;
  const records: Array<{
    path: string;
    contentHash: string;
    sizeBytes: number;
  }> = [];

  for (let i = 0; i < absPaths.length; i += BATCH) {
    const settled = await Promise.allSettled(
      absPaths.slice(i, i + BATCH).map(async (absPath) => {
        const content = await sandbox.files.read(absPath);
        const hash = sha256Hex(content);
        const sizeBytes = Buffer.byteLength(content, "utf-8");
        const relPath = absPath.startsWith(`${WORK_DIR}/`)
          ? absPath.slice(WORK_DIR.length + 1)
          : absPath;
        await putBlob(userId, projectId, hash, content);
        return { path: relPath, contentHash: hash, sizeBytes };
      }),
    );

    for (const result of settled) {
      if (result.status === "fulfilled") {
        records.push(result.value);
      } else {
        log.warn("sandbox.seed.skip", {
          jobId,
          projectId,
          reason: String(result.reason),
        });
      }
    }
  }

  if (records.length === 0) return;

  // Persist all records in a single transaction with one headSequence bump.
  await prisma.$transaction(async (tx) => {
    const seq = await allocateHeadSequence(tx, projectId);
    for (const record of records) {
      await tx.projectFile.upsert({
        where: { projectId_path: { projectId, path: record.path } },
        create: { projectId, ...record, lastSequence: seq },
        update: { ...record, lastSequence: seq },
      });
    }
  });

  log.info("sandbox.seed.done", { jobId, projectId, files: records.length });

  // Tell the frontend to refetch the tree
  await publish(jobId, { type: "resync" });
}

async function rehydrateSandbox(
  sandbox: Sandbox,
  projectId: string,
  userId: string,
  jobId: string,
): Promise<void> {
  const files = await prisma.projectFile.findMany({
    where: { projectId },
    select: { path: true, contentHash: true },
    orderBy: { path: "asc" },
  });

  if (files.length === 0) {
    await seedTemplateFiles(sandbox, projectId, userId, jobId);
    return;
  }

  log.info("sandbox.rehydrate.start", {
    jobId,
    projectId,
    files: files.length,
  });

  // Fetch blobs from R2 and write to the sandbox in bounded concurrent batches.
  const BATCH = 10;
  for (let i = 0; i < files.length; i += BATCH) {
    const settled = await Promise.allSettled(
      files.slice(i, i + BATCH).map(async ({ path, contentHash }) => {
        // Support both legacy absolute paths (/home/user/app/…) and relative paths.
        const absPath = path.startsWith("/") ? path : `${WORK_DIR}/${path}`;
        // Binary assets must round-trip as raw bytes — a UTF-8 decode/encode
        // would corrupt them. Text files go through the string path as before.
        if (isBinaryPath(path)) {
          const bytes = await getBlob(userId, projectId, contentHash);
          // e2b's write takes an ArrayBuffer; hand it the blob's exact bytes.
          const ab = bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ) as ArrayBuffer;
          await sandbox.files.write(absPath, ab);
        } else {
          const content = await getBlobText(userId, projectId, contentHash);
          await sandbox.files.write(absPath, content);
        }
      }),
    );

    for (const result of settled) {
      if (result.status === "rejected") {
        log.warn("sandbox.rehydrate.skip", {
          jobId,
          projectId,
          reason: String(result.reason),
        });
      }
    }
  }

  // Restore node_modules for any deps added or changed beyond the template baseline.
  try {
    await sandbox.commands.run(
      `cd ${WORK_DIR} && bun install --frozen-lockfile`,
      { timeoutMs: 2 * 60_000 },
    );
    log.info("sandbox.rehydrate.done", { jobId, projectId });
  } catch (err) {
    log.warn("sandbox.rehydrate.install_failed", {
      jobId,
      projectId,
      error: String(err),
    });
  }
}

async function createFreshSandbox(
  projectId: string,
  userId: string,
  jobId: string,
  templateKey: TemplateKey,
  allowRetry = true,
): Promise<Sandbox> {
  const e2bName = e2bNameFor(templateKey);
  const sandbox = await Sandbox.create(e2bName, {
    timeoutMs: SANDBOX_IDLE_TIMEOUT_MS,
  });
  log.info("sandbox.provision", {
    jobId,
    projectId,
    sandboxId: sandbox.sandboxId,
    template: e2bName,
    templateKey,
  });

  try {
    await rehydrateSandbox(sandbox, projectId, userId, jobId);
  } catch (err) {
    if (!allowRetry) throw err;

    log.warn("sandbox.rehydrate.retry", {
      jobId,
      projectId,
      error: String(err),
    });
    return createFreshSandbox(projectId, userId, jobId, templateKey, false);
  }

  await prisma.project.update({
    where: { id: projectId },
    data: {
      sandboxId: sandbox.sandboxId,
      sandboxStatus: SandboxStatus.READY,
      // Lock in the template this project booted from so every later reconnect
      // and rehydration uses the same image the files were seeded against.
      templateKey,
    },
  });

  return sandbox;
}

export async function provisionSandbox(
  projectId: string,
  userId: string,
  jobId: string,
  requestedTemplateKey?: TemplateKey,
): Promise<Sandbox> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });
  if (!project) throw new Error(`Project ${projectId} not found`);

  if (project.sandboxId && project.sandboxStatus === SandboxStatus.READY) {
    try {
      log.info("sandbox.reconnect", {
        jobId,
        projectId,
        sandboxId: project.sandboxId,
      });
      const sandbox = await getSandbox(project.sandboxId);
      await verifySandboxAlive(sandbox);
      return sandbox;
    } catch (err) {
      log.warn("sandbox.reconnect.failed", {
        jobId,
        projectId,
        sandboxId: project.sandboxId,
        error: String(err),
      });
    }
  }

  // The template is locked once template files have been seeded — after that
  // the agent's requested key is ignored so we never switch out from under an
  // app whose files were scaffolded against a different image. Before then
  // (a truly fresh project) the agent's choice wins and gets persisted.
  const fileCount = await prisma.projectFile.count({ where: { projectId } });
  const templateLocked = fileCount > 0;
  const templateKey =
    !templateLocked && requestedTemplateKey
      ? requestedTemplateKey
      : toTemplateKey(project.templateKey);

  return createFreshSandbox(projectId, userId, jobId, templateKey);
}
