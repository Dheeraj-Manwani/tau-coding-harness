/**
 * The "Built with tau" badge on free-plan previews and published sites.
 *
 * The badge is never part of a project's source. It is added on the way out:
 *   - preview: the worker writes `previewBadgeScript()` into the sandbox
 *     *outside* the app directory, and the dev-only visual-edit tagger inlines
 *     it into every page the Vite dev server serves;
 *   - published: the site handler inserts `siteBadgeTag()` into HTML responses,
 *     and `/_tau/badge.js` serves the script.
 *
 * So it never enters the file manifest, never reaches a GitHub push, never
 * lands in a build, and the agent has nothing to delete. It follows the owner's
 * *current* plan: upgrading removes it everywhere without a republish.
 */
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { env } from "@/lib/env";
import { Plan } from "@/generated/prisma/enums";

/** Where published sites load the script from. Absolute, so it resolves the
 *  same on `{slug}.{SITES_DOMAIN}` and on `/sites/{slug}/`. */
export const BADGE_SCRIPT_PATH = "/_tau/badge.js";

/**
 * Where the preview badge lives inside the sandbox: beside the app, not in it.
 * Outside `/home/user/app` means the template seed's `find` never picks it up
 * and the agent never sees it. The tagger reads it as `<root>/../.tau-badge.js`
 * — keep the two in step.
 */
export const PREVIEW_BADGE_SANDBOX_PATH = "/home/user/.tau-badge.js";

export function showsBadge(plan: Plan | null | undefined): boolean {
  return (plan ?? Plan.FREE) === Plan.FREE;
}

const BADGE_FILE = new URL("./badge.js", import.meta.url);

let cached: {
  mtimeMs: number;
  source: string;
  hash: string;
  etag: string;
} | null = null;

/**
 * The badge script itself, plus a content hash that versions its URL.
 *
 * Re-read whenever the file's mtime moves. `bun --watch` restarts on imported
 * modules, not on files read off disk, so a read-once cache would keep serving
 * (and writing into sandboxes) whatever was on disk when the process started.
 * A stat per call is cheap; the read only happens on change.
 */
export function badgeScript(): { source: string; hash: string; etag: string } {
  const { mtimeMs } = statSync(BADGE_FILE);
  if (!cached || cached.mtimeMs !== mtimeMs) {
    const source = readFileSync(BADGE_FILE, "utf8");
    const hash = createHash("sha256").update(source).digest("hex").slice(0, 12);
    cached = { mtimeMs, source, hash, etag: `"${hash}"` };
  }
  return cached;
}

function links() {
  return {
    home: env.LANDING_URL,
    upgrade: `${env.APP_URL.replace(/\/+$/, "")}/billing`,
  };
}

/** Config + script as one classic script, for the tagger to inline. Inlined
 *  means a literal `</script` anywhere would end the tag early, so it can't. */
export function previewBadgeScript(): string {
  const config = JSON.stringify({ mode: "preview", ...links() });
  return `window.__TAU_BADGE__=${config};\n${badgeScript().source}`.replace(
    /<\/script/gi,
    "<\\/script",
  );
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

/** The `<script>` tag a published page gets. Configured by data attributes
 *  rather than an inline script, so a page with a strict CSP still loads it.
 *  The `?v=` content hash means a changed badge is a new URL: pages (which
 *  always revalidate) pick it up at once instead of waiting out a cache. */
export function siteBadgeTag(slug: string): string {
  const { home, upgrade } = links();
  return (
    `<script src="${BADGE_SCRIPT_PATH}?v=${badgeScript().hash}" defer data-mode="site"` +
    ` data-home="${escapeAttr(home)}" data-upgrade="${escapeAttr(upgrade)}"` +
    ` data-site="${escapeAttr(slug)}"></script>`
  );
}

/** Insert `tag` before the last `</body>`, or append it when there is none. */
export function injectBeforeBodyEnd(html: string, tag: string): string {
  const i = html.toLowerCase().lastIndexOf("</body>");
  return i === -1 ? html + tag : html.slice(0, i) + tag + html.slice(i);
}
