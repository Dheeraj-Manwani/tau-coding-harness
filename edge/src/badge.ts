/**
 * The "Built with tau" badge, as the edge adds it to a page.
 *
 * Pure string work with no Worker types, so the server's drift test can run the
 * same inputs through this and through `server/src/lib/badge`, which must
 * produce the same bytes. A page the edge badges and a page the server badges
 * have to be indistinguishable, ETags included.
 */
import { BADGE_SOURCE } from "./badgeSource";

/** Where published sites load the script from. Reserved on every site host. */
export const BADGE_SCRIPT_PATH = "/_tau/badge.js";

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

let badgeCache: { hash: string } | null = null;
export async function badgeHash(): Promise<string> {
  badgeCache ??= { hash: (await sha256Hex(BADGE_SOURCE)).slice(0, 12) };
  return badgeCache.hash;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** The `<script>` tag a free-plan page gets. Same bytes as `siteBadgeTag` on the server. */
export async function siteBadgeTag(slug: string, env: { LANDING_URL: string; APP_URL: string }): Promise<string> {
  const upgrade = `${env.APP_URL.replace(/\/+$/, "")}/billing`;
  return (
    `<script src="${BADGE_SCRIPT_PATH}?v=${await badgeHash()}" defer data-mode="site"` +
    ` data-home="${escapeAttr(env.LANDING_URL)}" data-upgrade="${escapeAttr(upgrade)}"` +
    ` data-site="${escapeAttr(slug)}"></script>`
  );
}

/** Insert `tag` before the last `</body>`, or append it when there is none. */
export function injectBeforeBodyEnd(html: string, tag: string): string {
  const i = html.toLowerCase().lastIndexOf("</body>");
  return i === -1 ? html + tag : html.slice(0, i) + tag + html.slice(i);
}

/** `"abc"` + tag -> `"abc-tb1a2b3c4d"`: the badge changes the bytes, so the ETag must too. */
export async function withVariant(etag: string, tag: string): Promise<string> {
  const suffix = (await sha256Hex(tag)).slice(0, 8);
  return etag.endsWith('"') ? `${etag.slice(0, -1)}-tb${suffix}"` : `${etag}-tb${suffix}`;
}

