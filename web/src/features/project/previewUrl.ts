/**
 * The preview URL bar shows only the path — `/` for the app root, `/home` for
 * `https://<sandbox>.e2b.app/home`. The sandbox origin is noise: it's a
 * generated hostname the user never chose and can't meaningfully edit.
 */

/**
 * Coerce whatever the user typed into a path.
 *
 * Accepts a bare segment (`home`), a rooted path (`/home`), a path with query
 * and hash (`/items?id=1#top`), or a full URL pasted from the address bar — in
 * which case only the part after the origin is kept.
 */
export function normalizePreviewPath(input: string): string {
  const raw = input.trim();
  if (!raw) return "/";

  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      return `${url.pathname}${url.search}${url.hash}` || "/";
    } catch {
      // Not a parseable URL — fall through and treat it as a path.
    }
  }

  return raw.startsWith("/") ? raw : `/${raw}`;
}

/** Absolute URL for the iframe / "open in new tab", or null with no preview. */
export function previewSrc(
  origin: string | null,
  path: string,
): string | null {
  if (!origin) return null;
  return `${origin.replace(/\/+$/, "")}${normalizePreviewPath(path)}`;
}
