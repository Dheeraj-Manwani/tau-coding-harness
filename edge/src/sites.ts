/**
 * The addressing and serving rules for published sites, as the edge needs them.
 *
 * A port of the pure functions in `server/src/lib/sites.ts`, which imports the
 * server's environment and so cannot be imported here. The two copies are kept
 * honest by `server/test/api/siteEdgeDrift.test.ts`, which runs one table of
 * inputs through both (it lives in the server because it needs the server's
 * environment to load). Change a rule in both places.
 */

/** Everything a deployment's files live under. The router refuses any other prefix. */
export const SITE_PREFIX = "tau/sites";

/** R2 key for one file inside a deployment, given its prefix. */
export function siteObjectKey(storagePrefix: string, path: string): string {
  return `${storagePrefix}/${normalizeSitePath(path)}`;
}

/**
 * Collapse a request path to the object path it addresses.
 *
 * The security boundary between a request path and an R2 key: `..` segments
 * must not survive, leading slashes go, `.` is resolved away, and a directory
 * request becomes its `index.html`.
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
  if (raw.endsWith("/") || !segments[segments.length - 1]!.includes(".")) {
    return `${joined}/index.html`;
  }
  return joined;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

const SLUG_MAX = 40;

/** A DNS label: lowercase alphanumerics and hyphens, no leading or trailing hyphen, 3 to 40. */
export function isValidSlug(value: string): boolean {
  return (
    value.length >= 3 &&
    value.length <= SLUG_MAX &&
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value)
  );
}

/**
 * The slug a request is for, from its Host header, or null when the host is not
 * a single label under the sites domain.
 */
export function slugFromHost(host: string | undefined, domain: string | undefined): string | null {
  if (!domain || !host) return null;

  const hostname = host.split(":")[0]!.toLowerCase().replace(/\.$/, "");
  const suffix = `.${domain}`;
  if (!hostname.endsWith(suffix)) return null;

  const label = hostname.slice(0, -suffix.length);
  if (!label || label.includes(".")) return null;
  return isValidSlug(label) ? label : null;
}

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

/** Content type for a published file. Unknown extensions download rather than render. */
export function contentTypeFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  if (!ext || ext === path) return "application/octet-stream";
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

/**
 * Cache-Control for a published file: fingerprinted assets are immutable for a
 * year; everything else, above all `index.html`, revalidates.
 */
export function cacheControlFor(path: string): string {
  return /^assets\/.+-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/.test(path)
    ? "public, max-age=31536000, immutable"
    : "public, max-age=0, must-revalidate";
}

/** Whether the last segment of a request path has a file extension. */
export function hasExtension(rawPath: string): boolean {
  const last = rawPath.split("?")[0]!.split("/").pop() ?? "";
  return last.includes(".");
}
