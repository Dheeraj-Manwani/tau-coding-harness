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

/**
 * Extensions whose blobs are binary and must NOT be read/served/committed as
 * UTF-8 text. Kept in sync with the worker's `isBinaryPath`
 * (`worker-service/src/agent/tools/functions/utils.ts`). SVG is intentionally
 * excluded — it is XML text.
 */
const BINARY_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "bmp",
  "ico",
  "tiff",
  "tif",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "eot",
  "mp3",
  "wav",
  "ogg",
  "mp4",
  "webm",
  "mov",
  "pdf",
]);

export function isBinaryPath(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot === -1) return false;
  return BINARY_EXTENSIONS.has(path.slice(dot + 1).toLowerCase());
}

// ── Secret paths ────────────────────────────────────────────────────────────

/**
 * Paths that must never enter the `ProjectFile` manifest.
 *
 * The manifest is the input to the GitHub push (`buildProjectTree`), so a row
 * here is a row in the user's repository. Secrets therefore have to be stopped
 * at persist time, not filtered at push time — by then the bytes are already in
 * R2 and one missed call site publishes them.
 *
 * This is the unconditional floor. The push path *also* honors the project's
 * `.gitignore` (see `filterPushableFiles` in `lib/github.ts`), but a user who
 * deletes their `.gitignore` must not thereby start publishing keys.
 *
 * Matched against the basename except where the pattern contains a `/`.
 * Kept in sync with the worker's copy
 * (`worker-service/src/agent/tools/functions/utils.ts`), the same way
 * `isBinaryPath` is.
 */
const SECRET_PATTERNS: RegExp[] = [
  // Every dotenv flavor, including `.env.example`. Placeholder files are a real
  // convention, but the template's own .gitignore already excludes `.env.*`, so
  // allowing them here would buy nothing and require judging which are safe.
  /^\.env(\..*)?$/i,
  // Private keys, certs and keystores.
  /\.(pem|key|p12|pfx|jks|keystore|asc|gpg)$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\..*)?$/i,
  // Credential files for the tools an agent might plausibly run.
  /^\.(npmrc|netrc|pypirc|dockercfg)$/i,
  /^\.?docker\/config\.json$/i,
];

/** Directory prefixes whose entire subtree is excluded. */
const SECRET_DIR_PREFIXES = [".git/", ".ssh/", ".aws/", ".gnupg/"];

/**
 * True when `path` (project-relative) is credential-shaped and must never be
 * persisted, served from the manifest, or pushed.
 */
export function isSecretPath(path: string): boolean {
  const rel = path.replace(/^\/+/, "");
  if (SECRET_DIR_PREFIXES.some((d) => rel === d.slice(0, -1) || rel.startsWith(d)))
    return true;
  // A nested `server/.env` is exactly as dangerous as a root one.
  const base = rel.slice(rel.lastIndexOf("/") + 1);
  return SECRET_PATTERNS.some((re) => re.test(base) || re.test(rel));
}

export interface WriteProjectFileResult {
  contentHash: string;
  sizeBytes: number;
  /** null when the content was unchanged and no sequence was allocated. */
  headSequence: number | null;
  changed: boolean;
  /**
   * False when the path is credential-shaped (`isSecretPath`) and was
   * deliberately kept out of the manifest. The caller has still written the
   * sandbox; the bytes just don't survive a rebuild and never reach GitHub.
   */
  persisted: boolean;
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

  // Credential-shaped paths never enter the manifest — see `isSecretPath`. We
  // return before `putBlob` so the bytes don't reach R2 either.
  if (isSecretPath(path)) {
    return {
      contentHash,
      sizeBytes,
      headSequence: null,
      changed: false,
      persisted: false,
    };
  }

  const existing = await prisma.projectFile.findUnique({
    where: { projectId_path: { projectId, path } },
    select: { contentHash: true },
  });

  if (existing?.contentHash === contentHash) {
    return {
      contentHash,
      sizeBytes,
      headSequence: null,
      changed: false,
      persisted: true,
    };
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

  return { contentHash, sizeBytes, headSequence, changed: true, persisted: true };
}

/**
 * The binary sibling of `writeProjectFile`.
 *
 * A separate function rather than a `string | Uint8Array` parameter because the
 * two differ in more than the argument type: the hash and the size come from the
 * raw bytes (a UTF-8 `Buffer.byteLength` of an image is meaningless), and there
 * is no `inTransaction` hook — a binary asset has no diff, so there is no
 * `USER_EDIT` message to attach to it. The agent learns about a swapped image
 * from the JSX change that points at it, which does carry a diff.
 */
export async function writeProjectBinaryFile(
  projectId: string,
  userId: string,
  path: string,
  bytes: Uint8Array,
): Promise<WriteProjectFileResult> {
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  const sizeBytes = bytes.byteLength;

  if (isSecretPath(path)) {
    return {
      contentHash,
      sizeBytes,
      headSequence: null,
      changed: false,
      persisted: false,
    };
  }

  const existing = await prisma.projectFile.findUnique({
    where: { projectId_path: { projectId, path } },
    select: { contentHash: true },
  });
  if (existing?.contentHash === contentHash) {
    return {
      contentHash,
      sizeBytes,
      headSequence: null,
      changed: false,
      persisted: true,
    };
  }

  await putBlob(userId, projectId, contentHash, bytes);

  const headSequence = await prisma.$transaction(async (tx) => {
    const seq = await allocateHeadSequence(tx, projectId);
    await tx.projectFile.upsert({
      where: { projectId_path: { projectId, path } },
      create: { projectId, path, contentHash, sizeBytes, lastSequence: seq },
      update: { contentHash, sizeBytes, lastSequence: seq },
    });
    return seq;
  });

  return { contentHash, sizeBytes, headSequence, changed: true, persisted: true };
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
