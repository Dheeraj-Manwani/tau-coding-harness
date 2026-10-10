/**
 * Authentication for `/storage` (doc/TAU_CLOUD_STORAGE.md D3).
 *
 * The project, the owner and the environment come from the key row. Nothing in
 * the request can change them. Errors are flat `{ error, code }`.
 */
import type { Request, Response, NextFunction } from "express";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { touchStorageKey, verifyStorageKey } from "@/lib/storageKeys";
import { captureException } from "../lib/log";
import { StorageError, storageErrors } from "../lib/storageErrors";
import type { StorageCtx } from "../services/storage.service";

declare global {
  namespace Express {
    interface Request {
      storage?: StorageCtx & { keyId: string };
    }
  }
}

function extractKey(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

function deny(res: Response, err: StorageError): void {
  res.status(err.status).json({ error: err.message, code: err.code });
}

// ── rate limit ────────────────────────────────────────────────────────────────
// In memory and per key, like the gateway's: one process, no shared store.

const WINDOW_MS = 60_000;
const recentRequests = new Map<string, number[]>();
let lastSweep = 0;

function sweepIdleKeys(now: number): void {
  if (now - lastSweep < WINDOW_MS) return;
  lastSweep = now;
  for (const [keyId, stamps] of recentRequests) {
    if ((stamps[stamps.length - 1] ?? 0) <= now - WINDOW_MS) recentRequests.delete(keyId);
  }
}

/** True when this request fits in the key's allowance (and counts it). */
export function takeRequest(keyId: string, now = Date.now()): boolean {
  sweepIdleKeys(now);
  const stamps = (recentRequests.get(keyId) ?? []).filter((t) => t > now - WINDOW_MS);
  if (stamps.length >= env.STORAGE_RPM) {
    recentRequests.set(keyId, stamps);
    return false;
  }
  stamps.push(now);
  recentRequests.set(keyId, stamps);
  return true;
}

/** Test seam: the limiter state is per process and sticky. */
export function __resetStorageLimiter(): void {
  recentRequests.clear();
  lastSweep = 0;
}

export async function requireStorageKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  const presented = extractKey(req);
  if (!presented) {
    deny(res, new StorageError(401, "missing_api_key", "No storage key provided. Pass it as `Authorization: Bearer tau_st_…`."));
    return;
  }

  try {
    const key = await verifyStorageKey(presented);
    if (!key) {
      // One message for unknown, revoked and expired-grace keys alike.
      deny(res, new StorageError(401, "invalid_api_key", "Invalid storage key."));
      return;
    }

    if (!takeRequest(key.id)) {
      deny(res, new StorageError(429, "rate_limit_exceeded", `Rate limit reached (${env.STORAGE_RPM} requests/minute). Slow down and retry.`));
      return;
    }

    const project = await prisma.project.findUnique({
      where: { id: key.projectId },
      select: { storageSuspendedAt: true },
    });
    if (!project) {
      deny(res, new StorageError(401, "invalid_api_key", "Invalid storage key."));
      return;
    }
    if (project.storageSuspendedAt) {
      deny(res, storageErrors.suspended());
      return;
    }

    req.storage = { keyId: key.id, projectId: key.projectId, userId: key.userId, env: key.env };
    void touchStorageKey(key).catch(() => {});
    next();
  } catch (err) {
    captureException(err, { detail: "storage key verification failed" });
    deny(res, new StorageError(500, "internal_error", "Could not verify the storage key."));
  }
}
