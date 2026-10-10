/**
 * Pure rules for Tau Cloud Storage: what a file may be called, and how it may
 * be served. No I/O, so every rule has a test (doc/TAU_CLOUD_STORAGE.md §4, D9).
 */

const MAX_KEY_CHARS = 512;
const MAX_SEGMENT_CHARS = 255;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export type KeyResult = { ok: true; key: string } | { ok: false; reason: string };

/**
 * The app's name for a file, such as `users/42/avatar.png`. Slashes are only a
 * convention that prefix listing understands; the name never reaches R2.
 */
export function normalizeObjectKey(raw: unknown): KeyResult {
  if (typeof raw !== "string") return { ok: false, reason: "key must be a string" };
  const key = raw.normalize("NFC");
  if (key.length === 0) return { ok: false, reason: "key is empty" };
  if (key.length > MAX_KEY_CHARS) return { ok: false, reason: `key is longer than ${MAX_KEY_CHARS} characters` };
  if (CONTROL_CHARS.test(key)) return { ok: false, reason: "key contains a control character" };
  if (key.startsWith("/")) return { ok: false, reason: "key must not start with a slash" };
  for (const segment of key.split("/")) {
    if (segment === "") return { ok: false, reason: "key has an empty segment" };
    if (segment === "." || segment === "..") return { ok: false, reason: "key has a . or .. segment" };
    if (segment.length > MAX_SEGMENT_CHARS) return { ok: false, reason: `a segment is longer than ${MAX_SEGMENT_CHARS} characters` };
  }
  return { ok: true, key };
}

/** A listing prefix: like a key, but may be empty or end in a slash. */
export function normalizePrefix(raw: unknown): KeyResult {
  if (raw === undefined || raw === null || raw === "") return { ok: true, key: "" };
  if (typeof raw !== "string") return { ok: false, reason: "prefix must be a string" };
  const trailing = raw.endsWith("/");
  const body = trailing ? raw.slice(0, -1) : raw;
  const result = normalizeObjectKey(body);
  if (!result.ok) return result;
  return { ok: true, key: trailing ? `${result.key}/` : result.key };
}

/** The last segment of a key: what a file manager shows as its name. */
export function nameOf(key: string): string {
  const i = key.lastIndexOf("/");
  return i === -1 ? key : key.slice(i + 1);
}

const INLINE_TYPES = [
  /^image\/(png|jpe?g|gif|webp|avif|bmp|x-icon)$/,
  /^application\/pdf$/,
  /^audio\//,
  /^video\//,
  /^text\/plain$/,
];

/** A type a browser may show in place. HTML and SVG are never on the list: both
 *  can run script, and a file is only as safe as what the browser does with it. */
export function isInlineSafe(contentType: string): boolean {
  const base = contentType.split(";")[0]!.trim().toLowerCase();
  return INLINE_TYPES.some((re) => re.test(base));
}

export interface Disposition {
  /** Value for `Content-Disposition`. */
  header: string;
  /** Value for `Content-Type`; a download is sent as opaque bytes. */
  contentType: string;
}

/** RFC 6266: an ASCII fallback plus the UTF-8 form. */
function filenameParams(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const utf8 = encodeURIComponent(name).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  return `filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

/**
 * How a signed download address should make the browser treat the file (D9).
 * Safe types open in place unless the caller asked for a download; everything
 * else, always including HTML and SVG, is an attachment of opaque bytes.
 */
export function dispositionFor(contentType: string, name: string, download: boolean): Disposition {
  if (!download && isInlineSafe(contentType)) {
    return { header: `inline; ${filenameParams(name)}`, contentType };
  }
  return { header: `attachment; ${filenameParams(name)}`, contentType: "application/octet-stream" };
}

/** Content types come from the uploader; keep them to something a header can carry. */
export function normalizeContentType(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (v.length === 0 || v.length > 200) return null;
  if (!/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+(\s*;\s*[\w-]+=[^;\r\n]+)*$/.test(v)) return null;
  return v.toLowerCase();
}
