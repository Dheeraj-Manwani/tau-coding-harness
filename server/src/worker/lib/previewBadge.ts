/**
 * Put the "Built with tau" badge into a free-plan sandbox's preview, or take it
 * out for Pro. See lib/badge for the whole design.
 *
 * Runs on every provision — fresh and reconnect — so the preview follows the
 * plan the owner has now. The tagger reads the file on each page load, so the
 * change shows on the next preview reload without restarting Vite. (Within a
 * session the web app also hides it live on upgrade, over postMessage.)
 */
import { prisma } from "@/lib/prisma";
import {
  PREVIEW_BADGE_SANDBOX_PATH,
  previewBadgeScript,
  showsBadge,
} from "@/lib/badge";
import type { Sandbox } from "./sandbox";
import { log } from "./log";

export async function syncPreviewBadge(
  sandbox: Sandbox,
  userId: string,
  jobId: string,
): Promise<void> {
  // Never fatal: a preview without its badge beats no preview at all.
  try {
    const account = await prisma.billingAccount.findUnique({
      where: { userId },
      select: { plan: true },
    });
    if (showsBadge(account?.plan)) {
      await sandbox.files.write(PREVIEW_BADGE_SANDBOX_PATH, previewBadgeScript());
    } else if (await sandbox.files.exists(PREVIEW_BADGE_SANDBOX_PATH)) {
      await sandbox.files.remove(PREVIEW_BADGE_SANDBOX_PATH);
    }
  } catch (err) {
    log.warn("preview_badge.sync_failed", { jobId, error: String(err) });
  }
}
