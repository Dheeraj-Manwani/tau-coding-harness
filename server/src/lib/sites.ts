/**
 * Naming and addressing for published sites.
 *
 * Pure functions only — no database, no R2 — so both the publish path (worker)
 * and the serving path (api) can share them, and so the rules that decide what
 * a public URL looks like are testable without infrastructure.
 */
import { env } from "@/lib/env";

export const SITE_PREFIX = "tau/sites";

/**
 * R2 prefix owning one build's output. Keyed by deployment id, never by slug:
 * a slug points at whichever build is live, so keying by it would make a new
 * build overwrite the bytes the current site is serving mid-upload.
 */
export function sitePrefix(
  userId: string,
  projectId: string,
  deploymentId: string,
): string {
  return `${SITE_PREFIX}/${userId}/${projectId}/${deploymentId}`;
}

/** Full R2 key for one file inside a deployment, given its prefix. */
export function siteObjectKey(storagePrefix: string, path: string): string {
  return `${storagePrefix}/${normalizeSitePath(path)}`;
}

/**
 * Collapse a request path to the object path it addresses.
 *
 * This is the security boundary of the site handler: whatever the browser
 * sends becomes part of an R2 key, so `..` segments must not survive. Leading
 * slashes go, `.` and `..` are resolved away, and a directory request becomes
 * its `index.html`.
 */
export function normalizeSitePath(raw: string): string {
  const decoded = safeDecode(raw);
  const segments: string[] = [];

  for (const segment of decoded.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  const joined = segments.join("/");
  if (!joined) return "index.html";
  // A trailing slash, or a final segment with no extension, addresses a
  // directory — the same convention every static host uses.
  if (raw.endsWith("/") || !segments[segments.length - 1]!.includes(".")) {
    return `${joined}/index.html`;
  }
  return joined;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // A malformed escape is not worth a 500; treat the bytes literally and let
    // the R2 lookup 404 the way any other unknown path does.
    return value;
  }
}

// ── Slugs ────────────────────────────────────────────────────────────────────

/** Room for a 6-char uniqueness suffix inside a comfortable DNS label. */
const SLUG_MAX = 40;
const SLUG_BASE_MAX = SLUG_MAX - 7;

/**
 * Slugs become DNS labels (`{slug}.usetau.app`), so the rules are DNS's, not
 * ours: lowercase alphanumerics and hyphens, no leading or trailing hyphen.
 */
export function isValidSlug(value: string): boolean {
  return (
    value.length >= 3 &&
    value.length <= SLUG_MAX &&
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value)
  );
}

/**
 * Derive a slug stem from a project name. Returns "app" for a name that
 * contains nothing usable (emoji-only, CJK, punctuation) rather than an empty
 * string — the caller appends a uniqueness suffix either way, so the result is
 * still a valid, distinct label.
 */
export function slugifyProjectName(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    // Strip combining marks so "Café" becomes "cafe", not "caf".
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_BASE_MAX)
    .replace(/-+$/, "");

  // Two-char stems are legal DNS but read as noise; the suffix carries the
  // identity in that case anyway.
  return base.length >= 3 ? base : "app";
}

/** `{stem}-{suffix}`, clamped so the whole thing stays a legal label. */
export function slugWithSuffix(stem: string, suffix: string): string {
  return `${stem.slice(0, SLUG_BASE_MAX)}-${suffix}`.slice(0, SLUG_MAX);
}

// ── Public URLs ──────────────────────────────────────────────────────────────

/**
 * Where a published site is reachable.
 *
 * With `SITES_DOMAIN` set this is the subdomain the plan calls for; without it,
 * the path-based route on this same server. Both are served by the same
 * handler, so the only difference is which one we tell the user about.
 *
 * The two settings are parameters with env defaults rather than direct reads,
 * so both branches are reachable from a test without reloading the module.
 */
export function publicSiteUrl(
  slug: string,
  opts: { domain?: string; origin?: string } = {},
): string {
  const domain = opts.domain ?? env.SITES_DOMAIN;
  if (domain) return `https://${slug}.${domain}`;
  const origin =
    opts.origin ?? env.SITES_ORIGIN ?? `http://localhost:${env.PORT}`;
  return `${origin}/sites/${slug}/`;
}

/**
 * Where a path-form request (`/sites/{slug}/…`) should be sent instead of being
 * served here, or null to serve it.
 *
 * Only ever the slug's own subdomain: the slug is checked against the DNS-label
 * rules first, so the host in the result cannot be chosen by the request, and
 * everything after it is the request's own path and query, carried over as
 * sent.
 *
 * The settings are parameters with env defaults for the same reason as in
 * `publicSiteUrl`.
 */
export function pathFormRedirect(
  slug: string,
  originalUrl: string,
  opts: { mode?: "serve" | "redirect"; domain?: string } = {},
): string | null {
  const mode = opts.mode ?? env.SITES_PATH_MODE;
  const domain = "domain" in opts ? opts.domain : env.SITES_DOMAIN;
  if (mode !== "redirect" || !domain || !isValidSlug(slug)) return null;

  // Cut on the URL as it arrived rather than rebuilding it from the decoded
  // route parameters, so an escaped path reaches the subdomain unchanged.
  const afterPrefix = originalUrl.replace(/^\/sites\//, "");
  const cut = afterPrefix.search(/[/?]/);
  const rest = cut === -1 ? "" : afterPrefix.slice(cut);
  return `https://${slug}.${domain}${rest.startsWith("/") ? rest : `/${rest}`}`;
}

/**
 * The slug a request is for, from its Host header, or null when the host is not
 * a site subdomain (the API's own domain, an IP, localhost).
 *
 * Returns null for everything when the domain is unset — otherwise any Host
 * header would be read as a slug and the API's own routes would start resolving
 * against published sites.
 */
export function slugFromHost(
  host: string | undefined,
  domain: string | undefined = env.SITES_DOMAIN,
): string | null {
  if (!domain || !host) return null;

  const hostname = host.split(":")[0]!.toLowerCase().replace(/\.$/, "");
  const suffix = `.${domain}`;
  if (!hostname.endsWith(suffix)) return null;

  const label = hostname.slice(0, -suffix.length);
  // Only a single label is a site. "a.b.usetau.app" is not "a.b".
  if (!label || label.includes(".")) return null;
  return isValidSlug(label) ? label : null;
}

// ── Content types ────────────────────────────────────────────────────────────

const CONTENT_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  cjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  bmp: "image/bmp",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  eot: "application/vnd.ms-fontobject",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  pdf: "application/pdf",
  wasm: "application/wasm",
  webmanifest: "application/manifest+json",
};

/**
 * Content type for a published file.
 *
 * Unknown extensions get `application/octet-stream`, which browsers download
 * rather than render — deliberately conservative, since these bytes are
 * user-generated and served from a domain we control.
 */
export function contentTypeFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  if (!ext || ext === path) return "application/octet-stream";
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

/**
 * Cache-Control for a published file.
 *
 * Vite fingerprints hashed assets (`/assets/index-a1b2c3d4.js`), so those are
 * immutable for a year. Everything else — above all `index.html`, which names
 * the current hashed bundles — must revalidate, or a publish would not be
 * visible until caches expired.
 */
export function cacheControlFor(path: string): string {
  return /^assets\/.+-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/.test(path)
    ? "public, max-age=31536000, immutable"
    : "public, max-age=0, must-revalidate";
}
