import { env } from "@/lib/env";
import { PREVIEW_BANNER_SANDBOX_PATH, PREVIEW_HEALTH_SANDBOX_PATH, previewBannerScript, previewHealthScript } from "@/lib/previewBanner";
import { readVisualEditAsset } from "../templates/shared";
import type { Sandbox } from "./sandbox";
import { log } from "./log";

/** All plans get the notice. Keep its script outside the exported app source. */
export async function syncPreviewBanner(sandbox: Sandbox, projectId: string, jobId: string): Promise<void> {
  try {
    await sandbox.files.write(PREVIEW_HEALTH_SANDBOX_PATH, previewHealthScript());
    await sandbox.files.write(PREVIEW_BANNER_SANDBOX_PATH, previewBannerScript(env.APP_URL, projectId));
    // Existing template images/live sandboxes may still have the old plugin.
    // Updating its bytes lets Vite reload the config and read the banner file.
    const taggerPath = "/home/user/app/.tau/tagger.ts";
    if (await sandbox.files.exists(taggerPath)) {
      const latest = readVisualEditAsset("tagger.ts");
      if (await sandbox.files.read(taggerPath) !== latest) {
        await sandbox.files.write(taggerPath, latest);
      }
    }
  } catch (err) {
    log.warn("preview_banner.sync_failed", { projectId, jobId, error: String(err) });
  }
}
