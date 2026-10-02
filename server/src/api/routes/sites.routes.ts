/**
 * Serving published sites.
 *
 * These routes are public and unauthenticated by definition — they are the
 * shipped app, visited by people who have never heard of tau — so they mount
 * before the global `requireAuth` and must never read a session.
 *
 * Two ways in, one handler:
 *   - `{slug}.{SITES_DOMAIN}/...`  when SITES_DOMAIN is configured;
 *   - `/sites/{slug}/...`          always, so publishing works with no DNS.
 *
 * The path form is not a fallback for the subdomain form — both stay live. It
 * is what makes publishing work on a laptop and on any host without a wildcard
 * record, and it is the origin a CDN would sit in front of.
 */
import { createHash } from "node:crypto";
import express, { Router, type Request, type Response } from "express";
import { getSiteObject } from "@/lib/s3";
import {
  BADGE_SCRIPT_PATH,
  badgeScript,
  injectBeforeBodyEnd,
  siteBadgeTag,
} from "@/lib/badge";
import {
  cacheControlFor,
  contentTypeFor,
  isValidSlug,
  normalizeSitePath,
  siteObjectKey,
  slugFromHost,
} from "@/lib/sites";
import { resolveLiveSite } from "../lib/siteLookup";

function notFound(res: Response, message: string): void {
  res
    .status(404)
    .type("text/html; charset=utf-8")
    .send(errorPage("Not found", message));
}

/**
 * Serve one file of a published site.
 *
 * SPA fallback: an unknown path with no file extension falls back to
 * `index.html`, because a React app's client-side routes exist only inside the
 * bundle. Asset requests (anything with an extension) 404 honestly instead —
 * returning HTML for a missing `.js` turns a broken build into an unreadable
 * MIME-type error in the console, which is much harder to diagnose.
 */
async function serveSite(
  slug: string,
  rawPath: string,
  req: Request,
  res: Response,
): Promise<void> {
  if (!isValidSlug(slug)) {
    notFound(res, "That site address isn't valid.");
    return;
  }

  const site = await resolveLiveSite(slug);
  if (!site) {
    notFound(res, "No app is published at this address yet.");
    return;
  }

  const path = normalizeSitePath(rawPath);
  let object = await getSiteObject(siteObjectKey(site.storagePrefix, path));
  let servedPath = path;

  if (!object && !hasExtension(rawPath)) {
    object = await getSiteObject(
      siteObjectKey(site.storagePrefix, "index.html"),
    );
    servedPath = "index.html";
  }

  if (!object) {
    notFound(res, "That page isn't part of this app.");
    return;
  }

  // Free-plan sites get the "Built with tau" badge, added here rather than at
  // publish time so it follows the owner's plan as it is now: an upgrade takes
  // it off every page within one lookup TTL, with no republish.
  let body: Uint8Array = object.body;
  let etag = object.etag;
  if (site.showBadge && contentTypeFor(servedPath).startsWith("text/html")) {
    const tag = siteBadgeTag(slug);
    body = new TextEncoder().encode(
      injectBeforeBodyEnd(new TextDecoder().decode(object.body), tag),
    );
    // The bytes differ from the stored object's, so the ETag must too — or a
    // browser that cached the badge-free page across a downgrade would get a
    // 304 for it forever (and vice versa across an upgrade).
    if (etag) etag = withVariant(etag, tag);
  }

  res.setHeader(
    "Content-Type",
    object.contentType || contentTypeFor(servedPath),
  );
  res.setHeader("Cache-Control", cacheControlFor(servedPath));
  // Published apps are user-written and served from a domain we control, so
  // they get the hardening any static host applies: no MIME sniffing, and no
  // framing by third parties.
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  if (etag) res.setHeader("ETag", etag);

  if (etag && req.headers["if-none-match"] === etag) {
    res.status(304).end();
    return;
  }

  res.status(200).send(Buffer.from(body));
}

/** `"abc"` + tag → `"abc-tb1a2b3c4d"`; weak validators keep their `W/`. */
function withVariant(etag: string, tag: string): string {
  const suffix = createHash("sha256").update(tag).digest("hex").slice(0, 8);
  return etag.endsWith('"')
    ? `${etag.slice(0, -1)}-tb${suffix}"`
    : `${etag}-tb${suffix}`;
}

/**
 * The badge script. Same bytes for every site. Pages ask for it as
 * `?v={content hash}`, so a matching version is immutable and a changed badge
 * is simply a new URL. Anything else (no `v`, or a stale one) revalidates every
 * time, so no browser can hold on to an old badge.
 */
function serveBadgeScript(req: Request, res: Response): void {
  const { source, hash, etag } = badgeScript();
  res.setHeader("Content-Type", "text/javascript; charset=utf-8");
  res.setHeader(
    "Cache-Control",
    req.query.v === hash
      ? "public, max-age=31536000, immutable"
      : "public, max-age=0, must-revalidate",
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("ETag", etag);
  if (req.headers["if-none-match"] === etag) {
    res.status(304).end();
    return;
  }
  res.status(200).send(source);
}

function hasExtension(rawPath: string): boolean {
  const last = rawPath.split("?")[0]!.split("/").pop() ?? "";
  return last.includes(".");
}

// `strict` is load-bearing, not a style choice. Express matches
// trailing-slash-insensitively by default, which would make `/sites/:slug`
// below also match `/sites/:slug/` — so the site root would redirect to itself,
// forever. With strict routing the two routes split cleanly: one handles the
// bare form, the other everything from the trailing slash down.
const router: express.Router = Router({ strict: true });

// Path-form sites (`/sites/{slug}/`) share this origin, so their absolute
// `/_tau/badge.js` lands here. Subdomain sites are caught by the middleware.
router.get(BADGE_SCRIPT_PATH, serveBadgeScript);

// No trailing slash redirects to one, so relative asset URLs in the served HTML
// resolve against the site root rather than against `/sites/`.
router.get("/sites/:slug", (req, res) => {
  res.redirect(308, `/sites/${req.params.slug}/`);
});

router.get("/sites/:slug/{*path}", (req, res, next) => {
  const rest = (req.params as { path?: string | string[] }).path;
  const rawPath = Array.isArray(rest) ? rest.join("/") : (rest ?? "");
  void serveSite(req.params.slug!, rawPath, req, res).catch(next);
});

/**
 * Host-based serving. Middleware rather than a route because it matches on the
 * Host header, not the path: on a site subdomain *every* path belongs to the
 * published app, including ones that collide with API routes.
 *
 * A no-op when SITES_DOMAIN is unset — `slugFromHost` returns null for every
 * host — so it cannot shadow the API's own routes by accident.
 */
export function siteHostMiddleware(): express.RequestHandler {
  return (req, res, next) => {
    const slug = slugFromHost(req.headers.host);
    if (!slug) {
      next();
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      // Static hosting is read-only. Anything else that arrives here is a
      // request meant for the API that landed on the wrong hostname.
      res.status(405).set("Allow", "GET, HEAD").end();
      return;
    }
    // Reserved on every site host; checked before R2 so an app cannot shadow it
    // with a file of its own at the same path.
    if (req.path === BADGE_SCRIPT_PATH) {
      serveBadgeScript(req, res);
      return;
    }
    void serveSite(slug, req.path, req, res).catch(next);
  };
}

function errorPage(title: string, message: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body { margin:0; min-height:100svh; display:grid; place-items:center;
         font: 16px/1.6 ui-sans-serif, system-ui, sans-serif;
         background:#0a0a0c; color:#e7e7ea; }
  main { text-align:center; padding:2rem; }
  h1 { font-size:1.25rem; margin:0 0 .5rem; }
  p { margin:0; color:#9a9aa4; }
</style>
</head>
<body><main><h1>${title}</h1><p>${message}</p></main></body>
</html>`;
}

export default router;
