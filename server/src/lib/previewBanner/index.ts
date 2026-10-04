import { readFileSync } from "node:fs";

export const PREVIEW_BANNER_SANDBOX_PATH = "/home/user/.tau-preview-banner.js";
export const PREVIEW_HEALTH_SANDBOX_PATH = "/home/user/.tau-preview-health.js";
// Set before navigation in the isolated cover-capture page, never in user tabs.
export const PREVIEW_CAPTURE_INIT_SCRIPT = "window.__TAU_PREVIEW_CAPTURE__ = true;";

export function previewHealthScript(): string {
  return readFileSync(new URL("./health.js", import.meta.url), "utf8").replace(/<\/script/gi, "<\\/script");
}

export function previewBannerScript(appUrl: string, projectId: string): string {
  const publishUrl = `${appUrl.replace(/\/+$/, "")}/project/${encodeURIComponent(projectId)}?publish=1`;
  const config = JSON.stringify({ projectId, publishUrl });
  const source = readFileSync(new URL("./banner.js", import.meta.url), "utf8");
  return `window.__TAU_PREVIEW_BANNER__=${config};\n${source}`.replace(/<\/script/gi, "<\\/script");
}
