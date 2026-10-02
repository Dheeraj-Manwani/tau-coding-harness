/**
 * The account page: a name, a picture, and a year of activity.
 *
 * Deliberately minimal. tau asks for nothing it won't show back to you: the
 * name and picture are optional, seeded once from Google when you sign in that
 * way, and everything else on the page is derived from what you've built.
 */
import { createHash } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { avatarKey, deleteObject, presignGet, putAttachmentBytes } from "@/lib/s3";
import { DeploymentStatus, JobType } from "@/generated/prisma/enums";
import { Errors } from "../lib/errors";
import { log } from "../lib/log";
import {
  activityWindowStart,
  buildActivity,
  type Activity,
} from "../lib/activity";
import {
  normalizeDisplayName,
  safeTimeZone,
} from "../schemas/profile.schema";

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

/** How long a presigned avatar URL lives; the redirect is cached for less. */
const AVATAR_URL_TTL_SECONDS = 60 * 60;
export const AVATAR_REDIRECT_MAX_AGE_SECONDS = 50 * 60;

export async function updateDisplayName(
  userId: string,
  displayName: string | null,
): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { displayName } });
}

// ── Avatar ───────────────────────────────────────────────────────────────────

/**
 * What the bytes actually are, by magic number. The declared Content-Type is
 * the client's opinion; this is the file's.
 */
export function sniffImageType(bytes: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/** Store `bytes` as the user's picture, replacing (and deleting) the old one. */
async function storeAvatar(
  userId: string,
  bytes: Buffer,
  opts: { onlyIfEmpty?: boolean } = {},
): Promise<boolean> {
  const mimeType = sniffImageType(bytes);
  if (!mimeType) throw Errors.badRequest("That doesn't look like a PNG, JPEG or WebP image");
  if (bytes.length > AVATAR_MAX_BYTES) throw Errors.badRequest("Pictures can be up to 2MB");

  const key = avatarKey(userId, createHash("sha256").update(bytes).digest("hex"));
  await putAttachmentBytes(key, bytes, mimeType);

  const previous = await prisma.user.findUnique({
    where: { id: userId },
    select: { avatarKey: true },
  });
  // `onlyIfEmpty` makes the Google import lose any race with a real upload.
  const { count } = await prisma.user.updateMany({
    where: opts.onlyIfEmpty ? { id: userId, avatarKey: null } : { id: userId },
    data: { avatarKey: key, avatarUpdatedAt: new Date() },
  });
  if (count === 0) {
    if (previous?.avatarKey !== key) await deleteQuietly(key);
    return false;
  }
  if (previous?.avatarKey && previous.avatarKey !== key) {
    await deleteQuietly(previous.avatarKey);
  }
  return true;
}

async function deleteQuietly(key: string): Promise<void> {
  try {
    await deleteObject(key);
  } catch (err) {
    log.warn("avatar.delete_failed", { key, error: String(err) });
  }
}

export async function uploadAvatar(userId: string, body: unknown): Promise<void> {
  if (!Buffer.isBuffer(body) || body.length === 0) {
    throw Errors.badRequest("No image received");
  }
  await storeAvatar(userId, body);
  log.info("avatar.uploaded", { userId, bytes: body.length });
}

export async function removeAvatar(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { avatarKey: true },
  });
  if (!user?.avatarKey) return;
  await prisma.user.update({
    where: { id: userId },
    data: { avatarKey: null, avatarUpdatedAt: new Date() },
  });
  await deleteQuietly(user.avatarKey);
}

/** A short-lived URL for the picture, or null when the user has none. */
export async function avatarUrlFor(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { avatarKey: true },
  });
  if (!user?.avatarKey) return null;
  return presignGet(user.avatarKey, AVATAR_URL_TTL_SECONDS);
}

// ── Google seeding ───────────────────────────────────────────────────────────

const GOOGLE_PHOTO_TIMEOUT_MS = 4_000;

/**
 * Only fetch from Google's own image host: this URL arrives in an OAuth profile,
 * and the server must not become a proxy for anything else.
 */
function googlePhotoUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !url.hostname.endsWith(".googleusercontent.com")) {
    return null;
  }
  // Google sizes the image by a `=s96-c` suffix; ask for something crisp.
  url.pathname = url.pathname.replace(/=s\d+(-c)?$/, "") + "=s256-c";
  return url.toString();
}

async function fetchGooglePhoto(url: string): Promise<Buffer | null> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(GOOGLE_PHOTO_TIMEOUT_MS),
    redirect: "error",
  });
  if (!res.ok) return null;
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > AVATAR_MAX_BYTES) return null;
  const bytes = Buffer.from(await res.arrayBuffer());
  return bytes.length <= AVATAR_MAX_BYTES && sniffImageType(bytes) ? bytes : null;
}

/**
 * Copy the Google name and photo onto the account, exactly once.
 *
 * `profileSeededAt` is claimed atomically before anything is written, so this
 * runs once per account no matter how many sign-ins race it — and never again,
 * which is what keeps a name or picture the user removed from coming back on
 * their next sign-in. Never throws: a failed import must not fail a login.
 */
export async function seedFromGoogle(
  userId: string,
  profile: { displayName?: string; photoUrl?: string },
): Promise<void> {
  try {
    const name = profile.displayName ? normalizeDisplayName(profile.displayName) : null;
    const claimed = await prisma.$queryRaw<{ avatarKey: string | null }[]>`
      UPDATE "User"
      SET "profileSeededAt" = NOW(),
          "displayName" = COALESCE("displayName", ${name})
      WHERE "id" = ${userId} AND "profileSeededAt" IS NULL
      RETURNING "avatarKey"
    `;
    if (claimed.length === 0 || claimed[0]!.avatarKey) return;

    const url = googlePhotoUrl(profile.photoUrl);
    if (!url) return;
    const bytes = await fetchGooglePhoto(url);
    if (bytes) await storeAvatar(userId, bytes, { onlyIfEmpty: true });
  } catch (err) {
    log.warn("profile.google_seed_failed", { userId, error: String(err) });
  }
}

// ── Activity ─────────────────────────────────────────────────────────────────

/**
 * A year of what the user did on tau, private to them.
 *
 *   builds   — generation jobs (one per prompt that ran)
 *   ships    — deployments that went live (READY, or SUPERSEDED by a later one)
 *   projects — projects created
 *
 * Deleted projects take their jobs with them, so the graph is "what you still
 * have", which is the honest reading anyway.
 */
export async function getActivity(
  userId: string,
  rawTimeZone: unknown,
  now: Date = new Date(),
): Promise<Activity> {
  const timeZone = safeTimeZone(rawTimeZone);
  const since = activityWindowStart(now);

  const [jobs, deployments, projects] = await Promise.all([
    prisma.job.findMany({
      where: {
        type: JobType.GENERATION,
        queuedAt: { gte: since },
        project: { userId },
      },
      select: { queuedAt: true },
    }),
    prisma.deployment.findMany({
      where: {
        userId,
        status: { in: [DeploymentStatus.READY, DeploymentStatus.SUPERSEDED] },
        createdAt: { gte: since },
      },
      select: { createdAt: true },
    }),
    prisma.project.findMany({
      where: { userId, createdAt: { gte: since } },
      select: { createdAt: true },
    }),
  ]);

  return buildActivity({
    builds: jobs.map((j) => j.queuedAt),
    ships: deployments.map((d) => d.createdAt),
    projects: projects.map((p) => p.createdAt),
    now,
    timeZone,
  });
}
