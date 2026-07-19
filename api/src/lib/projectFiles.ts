import { createHash } from "crypto";
import { createTwoFilesPatch } from "diff";
import { prisma } from "./prisma";
import { putBlob } from "./s3";
import { allocateHeadSequence } from "./headSequence";
import type { Prisma } from "../generated/prisma/client";

/** Mirrors `worker-service/src/agent/tools/functions/utils.ts:WORK_DIR`. */
export const WORK_DIR = "/home/user/app";

/**
 * Resolve a project-relative path to an absolute sandbox path.
 *
 * Mirrors `toWorkdirPath()` in the worker. The E2B `files.*` API has no `cwd`
 * option — it resolves relative paths against `/home/user`, NOT WORK_DIR
 * (`/home/user/app`) — so callers must anchor the path themselves.
 */
export function toWorkdirPath(p: string): string {
  if (p.startsWith("/")) return p;
  const rel = p.trim().replace(/^\.\//, "");
  return rel === "" || rel === "." ? WORK_DIR : `${WORK_DIR}/${rel}`;
}

export function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

export interface WriteProjectFileResult {
  contentHash: string;
  sizeBytes: number;
  /** null when the content was unchanged and no sequence was allocated. */
  headSequence: number | null;
  changed: boolean;
}

/**
 * Persist a file's content to R2 + the `ProjectFile` manifest, bumping
 * `Project.headSequence`.
 *
 * This is the storage half of the worker's `persistFile()` (which additionally
 * publishes a `file_done` event over the job's bus channel). A user edit has no
 * job to publish to, so it calls this directly.
 *
 * Does NOT write the sandbox — callers that want the live filesystem updated
 * must do that themselves (see `saveProjectFile` in project.service.ts).
 *
 * `opts.inTransaction` runs inside the same transaction as the manifest upsert,
 * so a caller can atomically attach related rows (the hidden USER_EDIT message)
 * to the file change. It never runs when the content is unchanged.
 */
export async function writeProjectFile(
  projectId: string,
  userId: string,
  path: string,
  content: string,
  opts: {
    inTransaction?: (
      tx: Prisma.TransactionClient,
      headSequence: number,
    ) => Promise<void>;
  } = {},
): Promise<WriteProjectFileResult> {
  const contentHash = sha256Hex(content);
  const sizeBytes = Buffer.byteLength(content, "utf-8");

  const existing = await prisma.projectFile.findUnique({
    where: { projectId_path: { projectId, path } },
    select: { contentHash: true },
  });

  if (existing?.contentHash === contentHash) {
    return { contentHash, sizeBytes, headSequence: null, changed: false };
  }

  await putBlob(userId, projectId, contentHash, content);

  const headSequence = await prisma.$transaction(async (tx) => {
    const seq = await allocateHeadSequence(tx, projectId);
    await tx.projectFile.upsert({
      where: { projectId_path: { projectId, path } },
      create: { projectId, path, contentHash, sizeBytes, lastSequence: seq },
      update: { contentHash, sizeBytes, lastSequence: seq },
    });
    await opts.inTransaction?.(tx, seq);
    return seq;
  });

  return { contentHash, sizeBytes, headSequence, changed: true };
}

// ── Diff summary for the hidden USER_EDIT message ───────────────────────────

/** Keep the diff small enough not to fight the model's context budget —
 *  aligned with the worker's MAX_TOOL_RESULT_TOKENS (2k). */
const MAX_DIFF_LINES = 100;

export interface EditDiff {
  diff: string;
  truncated: boolean;
  linesAdded: number;
  linesRemoved: number;
}

/**
 * Build a capped unified diff describing a user's manual edit.
 *
 * The agent can always `read_file` the live sandbox for the bytes — what it
 * can't do is *notice* a change, so this conveys what moved and (implicitly)
 * why. Over the cap we degrade to a pointer rather than shipping a huge patch.
 */
export function buildEditDiff(
  path: string,
  before: string,
  after: string,
): EditDiff {
  const patch = createTwoFilesPatch(path, path, before, after, "", "", {
    context: 3,
  });

  // Drop the ---/+++ file headers; the hidden message names the path already.
  const body = patch
    .split("\n")
    .filter(
      (l) =>
        !l.startsWith("---") &&
        !l.startsWith("+++") &&
        !l.startsWith("Index:") &&
        l !== "===================================================================",
    )
    .join("\n")
    .trim();

  let linesAdded = 0;
  let linesRemoved = 0;
  for (const line of body.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) linesAdded += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) linesRemoved += 1;
  }

  const bodyLines = body.split("\n");
  if (bodyLines.length > MAX_DIFF_LINES) {
    return {
      diff: `${bodyLines.slice(0, MAX_DIFF_LINES).join("\n")}\n… diff truncated …`,
      truncated: true,
      linesAdded,
      linesRemoved,
    };
  }

  return { diff: body, truncated: false, linesAdded, linesRemoved };
}
