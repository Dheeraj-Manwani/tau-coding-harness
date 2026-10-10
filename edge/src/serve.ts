/**
 * The router: one request in, one published file (or a plain page) out.
 *
 * The hostname picks a routing record from KV, the record names an immutable
 * prefix in R2, and the path picks a file under it. Nothing a visitor sends
 * chooses the prefix: it comes from the record only, and anything that does not
 * start with `tau/sites/` is refused (doc/PUBLISHING.md C4). The Worker holds no
 * secrets and calls nothing of tau's, so a published app keeps serving when
 * tau's own server is down.
 *
 * Mirrors `server/src/api/routes/sites.routes.ts`, rule for rule.
 */
import { BADGE_SOURCE } from "./badgeSource";
import { forwardToBackend, isApiPath, type ApiEnv, type ForwardDeps } from "./api";
import { BADGE_SCRIPT_PATH, badgeHash, injectBeforeBodyEnd, siteBadgeTag, withVariant } from "./badge";
import {
  SITE_PREFIX,
  cacheControlFor,
  contentTypeFor,
  hasExtension,
  isValidSlug,
  normalizeSitePath,
  siteObjectKey,
} from "./sites";

/** What tau writes to KV at `host:{hostname}`. Phases 3 and 4 add fields; unknown ones are ignored. */
export interface RoutingRecord {
  projectId: string;
  /** The label under the sites domain; what the badge reports. */
  slug: string;
  /** `tau/sites/{userId}/{projectId}/{deploymentId}`, no trailing slash. */
  prefix: string;
  showBadge: boolean;
  suspended: boolean;
  /** Send this hostname to another (308) instead of serving it. Set on the default address once a custom domain is primary. */
  redirectTo: string | null;
  /** The app's backend: a Lambda function URL for this deployment. Null for a static app. */
  api: { url: string } | null;
}

export interface Env extends ApiEnv {
  R2_BUCKET: R2Bucket;
  ROUTES: KVNamespace;
  /** Where the badge's links go. */
  LANDING_URL: string;
  APP_URL: string;
}

/** How long an edge location may keep a routing record. Also the longest a publish takes to show. */
export const RECORD_CACHE_SECONDS = 60;

function page(status: number, title: string, message: string, extra: HeadersInit = {}): Response {
  const body = `<!doctype html>
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
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "X-Content-Type-Options": "nosniff", ...extra },
  });
}

async function serveBadgeScript(request: Request): Promise<Response> {
  const hash = await badgeHash();
  const etag = `"${hash}"`;
  const url = new URL(request.url);
  const headers: Record<string, string> = {
    "Content-Type": "text/javascript; charset=utf-8",
    "Cache-Control":
      url.searchParams.get("v") === hash
        ? "public, max-age=31536000, immutable"
        : "public, max-age=0, must-revalidate",
    "X-Content-Type-Options": "nosniff",
    ETag: etag,
  };
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(request.method === "HEAD" ? null : BADGE_SOURCE, { status: 200, headers });
}

/** A record read from KV, or null when it is missing or not something this router understands. */
function usable(record: unknown): RoutingRecord | null {
  if (!record || typeof record !== "object") return null;
  const r = record as Partial<RoutingRecord>;
  if (typeof r.prefix !== "string" || typeof r.slug !== "string") return null;
  return {
    projectId: String(r.projectId ?? ""),
    slug: r.slug,
    prefix: r.prefix,
    showBadge: r.showBadge === true,
    suspended: r.suspended === true,
    redirectTo: typeof r.redirectTo === "string" ? r.redirectTo : null,
    api: typeof r.api?.url === "string" ? { url: r.api.url } : null,
  };
}

/**
 * Where a redirect record sends this request, or null when it must not redirect.
 *
 * The record is tau's, so the target is trusted to be an address tau chose, but
 * it is still checked: it must be an `https` URL for a different host (a record
 * pointing at itself would loop), and only its host is used, with the request's
 * own path and query carried over.
 */
export function redirectLocation(target: string | null, request: URL): string | null {
  if (!target) return null;
  let to: URL;
  try {
    to = new URL(target);
  } catch {
    return null;
  }
  if (to.protocol !== "https:" || to.hostname.toLowerCase() === request.hostname.toLowerCase()) return null;
  return `https://${to.host}${request.pathname}${request.search}`;
}

/** Whether a prefix may be served at all. The R2 binding reaches the whole bucket, which also holds project source. */
export function prefixAllowed(prefix: string): boolean {
  return (
    prefix.startsWith(`${SITE_PREFIX}/`) &&
    !prefix.endsWith("/") &&
    !prefix.split("/").some((s) => s === ".." || s === "." || s === "")
  );
}

export async function handle(request: Request, env: Env, deps: ForwardDeps = { fetcher: (input, init) => fetch(input, init) }): Promise<Response> {
  const url = new URL(request.url);

  // Static files are read-only. The app's own API takes every method: that is
  // the one place a visitor may send a body.
  if (request.method !== "GET" && request.method !== "HEAD" && !isApiPath(url.pathname)) {
    return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");

  // Reserved on every site host, and answered before the record is read, so an
  // app cannot shadow it with a file of its own at the same path.
  if (url.pathname === BADGE_SCRIPT_PATH) return serveBadgeScript(request);

  const raw = await env.ROUTES.get(`host:${hostname}`, { type: "json", cacheTtl: RECORD_CACHE_SECONDS });
  const record = usable(raw);
  if (!record) return page(404, "Not found", "No app is published at this address yet.");

  if (record.suspended) {
    // Every path, assets included. The reason is the owner's business.
    return page(403, "Site suspended", "This site has been suspended.", { "Cache-Control": "no-store" });
  }
  const elsewhere = redirectLocation(record.redirectTo, url);
  if (elsewhere) {
    // A permanent move, but cached only briefly: the owner can change which domain is primary.
    return new Response(null, { status: 308, headers: { Location: elsewhere, "Cache-Control": "public, max-age=300" } });
  }
  // `/api` belongs to the app's backend. With none, it is an honest 404, not the
  // front end's index.html answering a request meant for a server.
  if (isApiPath(url.pathname)) {
    if (!record.api) {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
      });
    }
    return forwardToBackend(request, record.api.url, env, deps);
  }

  if (!prefixAllowed(record.prefix) || !isValidSlug(record.slug)) {
    return page(404, "Not found", "No app is published at this address yet.");
  }

  const rawPath = url.pathname;
  let path = normalizeSitePath(rawPath);
  let object = await env.R2_BUCKET.get(siteObjectKey(record.prefix, path));

  // SPA fallback only for paths with no extension: a missing asset is an honest 404.
  if (!object && !hasExtension(rawPath)) {
    path = "index.html";
    object = await env.R2_BUCKET.get(siteObjectKey(record.prefix, path));
  }
  if (!object) return page(404, "Not found", "That page isn't part of this app.");

  const type = object.httpMetadata?.contentType || contentTypeFor(path);
  let etag = object.httpEtag;
  let body: BodyInit | null = object.body;

  if (record.showBadge && contentTypeFor(path).startsWith("text/html")) {
    const tag = await siteBadgeTag(record.slug, env);
    body = injectBeforeBodyEnd(await object.text(), tag);
    etag = await withVariant(etag, tag);
  }

  const headers = new Headers({
    "Content-Type": type,
    "Cache-Control": cacheControlFor(path),
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    ETag: etag,
  });

  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(request.method === "HEAD" ? null : body, { status: 200, headers });
}
