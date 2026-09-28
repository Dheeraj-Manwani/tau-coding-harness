/**
 * Fetch a remote image into the project (doc/archive/VISUAL_EDIT_PLAN.md §6 Phase 6).
 *
 * The API equivalent of the agent's `download_asset` tool, and it exists for the
 * same reason that tool does: a `src` pointing at someone else's server is a
 * borrowed image. It rots, it can be pulled, and it doesn't come with the user
 * when they export to GitHub. Importing the bytes into `public/` makes the image
 * genuinely theirs.
 *
 * The worker's version runs inside a job, driven by the agent, with a sandbox
 * and an event stream to hand. This one runs on the zero-credit path with a URL
 * a user typed, which changes the threat model completely — hence the guard
 * below.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/** Big enough for a real hero image, small enough not to matter. */
export const MAX_ASSET_BYTES = 10 * 1024 * 1024;

const FETCH_TIMEOUT_MS = 15_000;

/** Extension per image type we accept, and therefore the types we accept. */
const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/svg+xml": "svg",
};

export type AssetImportFailure =
  | "bad_url"
  | "blocked_host"
  | "fetch_failed"
  | "not_an_image"
  | "too_large"
  | "empty";

export type AssetImportResult =
  | { ok: true; bytes: Uint8Array; ext: string; mime: string }
  | { ok: false; reason: AssetImportFailure };

/**
 * Is this address one the server can reach but the user has no business
 * reaching through us?
 *
 * The whole SSRF question in one predicate. Our fetch runs inside the API's
 * network, so an unguarded "download this URL" is a request to read whatever the
 * API can read: the cloud metadata endpoint (`169.254.169.254`, which hands out
 * IAM credentials), Postgres on the private network, `localhost` admin routes.
 * Blocking by address rather than by hostname is what makes it hold —
 * `evil.com` resolving to `127.0.0.1` is the standard way around a name
 * blocklist.
 */
export function isBlockedAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const parts = ip.split(".").map(Number);
    const [a = 0, b = 0] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    if (a >= 224) return true; // multicast + reserved
    return false;
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === "::1" || s === "::") return true;
    if (s.startsWith("fe80") || s.startsWith("fc") || s.startsWith("fd")) {
      return true;
    }
    // IPv4-mapped (`::ffff:127.0.0.1`) would otherwise slip past the v4 rules.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (mapped?.[1]) return isBlockedAddress(mapped[1]);
    return false;
  }
  return true;
}

/** A filename stem safe to put in the manifest and in a URL path. */
export function slugifyAssetName(url: string): string {
  const last = url.split("?")[0]?.split("/").pop() ?? "";
  const stem = last.replace(/\.[^.]*$/, "");
  const slug = stem
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "image";
}

/**
 * Download and validate an image.
 *
 * Every check is a refusal, never a throw: the caller turns each into a message
 * the user can act on ("that link isn't an image"), which is the same shape as
 * the rest of visual edit's failures.
 */
export async function fetchImageAsset(
  rawUrl: string,
): Promise<AssetImportResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "bad_url" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: "bad_url" };
  }

  // Resolve the host ourselves and check every address it answers with. A host
  // that resolves to anything internal is refused outright.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  try {
    const addresses = isIP(host)
      ? [{ address: host }]
      : await lookup(host, { all: true });
    if (addresses.length === 0) return { ok: false, reason: "blocked_host" };
    if (addresses.some((a) => isBlockedAddress(a.address))) {
      return { ok: false, reason: "blocked_host" };
    }
  } catch {
    return { ok: false, reason: "blocked_host" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Accept: "image/*" },
      signal: controller.signal,
      // A redirect is a second URL that never went through the check above, so
      // it would reopen everything the DNS guard just closed.
      redirect: "manual",
    });
    if (!res.ok) return { ok: false, reason: "fetch_failed" };

    const mime = (res.headers.get("content-type") ?? "")
      .split(";")[0]
      ?.trim()
      .toLowerCase();
    const ext = mime ? EXT_BY_MIME[mime] : undefined;
    if (!ext || !mime) return { ok: false, reason: "not_an_image" };

    // Trust the header enough to bail early, but not enough to skip the real
    // check — a lying or absent Content-Length is why the buffer is measured too.
    const declared = Number(res.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > MAX_ASSET_BYTES) {
      return { ok: false, reason: "too_large" };
    }

    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength === 0) return { ok: false, reason: "empty" };
    if (bytes.byteLength > MAX_ASSET_BYTES) {
      return { ok: false, reason: "too_large" };
    }

    return { ok: true, bytes, ext, mime };
  } catch {
    return { ok: false, reason: "fetch_failed" };
  } finally {
    clearTimeout(timer);
  }
}
