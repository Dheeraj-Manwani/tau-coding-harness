import { createHash } from "crypto";
import { Sandbox } from "e2b";
import { prisma } from "./prisma";
import { redis } from "./redis";
import { env } from "./env";
import { getBlobText, putBlob } from "./s3";
import { publish } from "./publish";
import { allocateHeadSequence } from "./headSequence";
import { SandboxStatus } from "../generated/prisma/enums";

export type { Sandbox } from "e2b";

const TEMPLATE = "vite-hono-app";
export const WORK_DIR = "/home/user/app";

function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

export function getSandbox(sandboxId: string): Promise<Sandbox> {
  return Sandbox.connect(sandboxId, {
    timeoutMs: 10 * 60_000,
  });
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

  const absPaths = stdout.trim().split("\n").filter(Boolean);
  if (absPaths.length === 0) return;

  console.log(
    `[sandbox] seeding ${absPaths.length} template file(s) for project ${projectId}`,
  );

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
        console.warn(
          "[sandbox] skipped file during template seed:",
          result.reason,
        );
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

  console.log(
    `[sandbox] seeded ${records.length} template file(s) for project ${projectId}`,
  );

  // Tell the frontend to refetch the tree
  const idx = await redis.llen(`job:${jobId}:events`);
  await publish(jobId, { type: "resync" }, idx);
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

  console.log(
    `[sandbox] rehydrating ${files.length} file(s) for project ${projectId}`,
  );

  // Fetch blobs from R2 and write to the sandbox in bounded concurrent batches.
  const BATCH = 10;
  for (let i = 0; i < files.length; i += BATCH) {
    const settled = await Promise.allSettled(
      files.slice(i, i + BATCH).map(async ({ path, contentHash }) => {
        const content = await getBlobText(userId, projectId, contentHash);
        // Support both legacy absolute paths (/home/user/app/…) and relative paths.
        const absPath = path.startsWith("/") ? path : `${WORK_DIR}/${path}`;
        await sandbox.files.write(absPath, content);
      }),
    );

    for (const result of settled) {
      if (result.status === "rejected") {
        console.warn(
          "[sandbox] skipped file during rehydration:",
          result.reason,
        );
      }
    }
  }

  // Restore node_modules for any deps added or changed beyond the template baseline.
  try {
    await sandbox.commands.run(
      `cd ${WORK_DIR} && bun install --frozen-lockfile`,
      { timeoutMs: 2 * 60_000 },
    );
    console.log(`[sandbox] rehydration complete for project ${projectId}`);
  } catch (err) {
    console.warn(
      "[sandbox] bun install after rehydration failed (non-fatal):",
      err,
    );
  }
}

export async function provisionSandbox(
  projectId: string,
  userId: string,
  jobId: string,
): Promise<Sandbox> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });
  if (!project) throw new Error(`Project ${projectId} not found`);

  if (project.sandboxId && project.sandboxStatus === SandboxStatus.READY) {
    try {
      console.log(
        "[sandbox] reconnecting to existing sandbox",
        project.sandboxId,
      );
      return await getSandbox(project.sandboxId);
    } catch (err) {
      console.warn(
        `[sandbox] reconnect to ${project.sandboxId} failed; provisioning a new sandbox`,
        err,
      );
    }
  }

  const sandbox = await Sandbox.create(TEMPLATE, {
    timeoutMs: 10 * 60_000,
  });
  console.log("[sandbox] created new sandbox", sandbox.sandboxId);

  await rehydrateSandbox(sandbox, projectId, userId, jobId);

  await prisma.project.update({
    where: { id: projectId },
    data: {
      sandboxId: sandbox.sandboxId,
      sandboxStatus: SandboxStatus.READY,
    },
  });

  return sandbox;
}
