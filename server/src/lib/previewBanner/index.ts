import { readFileSync } from "node:fs";

export const PREVIEW_BANNER_SANDBOX_PATH = "/home/user/.tau-preview-banner.js";
export const PREVIEW_HEALTH_SANDBOX_PATH = "/home/user/.tau-preview-health.js";
// Set before navigation in the isolated cover-capture page, never in user tabs.
export const PREVIEW_CAPTURE_INIT_SCRIPT = "window.__TAU_PREVIEW_CAPTURE__ = true;";

/**
 * The bootstrap monitor, as it is inlined into every preview page.
 *
 * `appUrl` is where tau's own app is served. With it the monitor can hand over
 * the errors it saw, and only to that origin (see the head of `health.js`).
 * Without it, or with something that is not a URL, the monitor reports its
 * state and nothing more.
 */
export function previewHealthScript(appUrl?: string): string {
  const source = readFileSync(new URL("./health.js", import.meta.url), "utf8");
  let parentOrigin: string | null = null;
  try {
    parentOrigin = appUrl ? new URL(appUrl).origin : null;
  } catch {
    parentOrigin = null;
  }
  const config = parentOrigin ? `window.__TAU_PREVIEW_HEALTH__=${JSON.stringify({ parentOrigin })};\n` : "";
  return `${config}${source}`.replace(/<\/script/gi, "<\\/script");
}

export function previewBannerScript(appUrl: string, projectId: string): string {
  const publishUrl = `${appUrl.replace(/\/+$/, "")}/project/${encodeURIComponent(projectId)}?publish=1`;
  const config = JSON.stringify({ projectId, publishUrl });
  const source = readFileSync(new URL("./banner.js", import.meta.url), "utf8");
  return `window.__TAU_PREVIEW_BANNER__=${config};\n${source}`.replace(/<\/script/gi, "<\\/script");
}
