import { useEffect } from "react";

/**
 * Per-route `<title>`, description, canonical and Open Graph tags.
 *
 * This is a client-rendered SPA, so these tags exist only after hydration —
 * crawlers that run JS will see them, ones that don't won't. Phase 7's
 * prerender step is what turns this hook into something a search engine can
 * actually read; until then it is still what makes a pasted link render a
 * sensible card in Slack or iMessage once the page has loaded.
 *
 * Chosen over `react-helmet-async` deliberately: ~40 lines against a dependency
 * with a provider, a context and a server-rendering story we don't have.
 */

export interface DocumentMeta {
  /** Page title. `| tau` is appended unless `exactTitle` is set. */
  title: string;
  description?: string;
  /** Absolute or root-relative path. Defaults to the current pathname. */
  canonical?: string;
  /** Absolute or root-relative URL of the OG/Twitter card image. */
  image?: string;
  /** Use `title` verbatim, without the site-name suffix. */
  exactTitle?: boolean;
  /** Ask crawlers to skip this page (e.g. a docs 404). */
  noIndex?: boolean;
}

const SITE_NAME = "tau";

function upsertMeta(
  selectorAttr: "name" | "property",
  key: string,
  content: string | null,
): void {
  const selector = `meta[${selectorAttr}="${key}"]`;
  const existing = document.head.querySelector<HTMLMetaElement>(selector);

  if (content === null) {
    existing?.remove();
    return;
  }

  const tag = existing ?? document.createElement("meta");
  tag.setAttribute(selectorAttr, key);
  tag.setAttribute("content", content);
  if (!existing) document.head.appendChild(tag);
}

function upsertCanonical(href: string | null): void {
  const existing = document.head.querySelector<HTMLLinkElement>(
    'link[rel="canonical"]',
  );
  if (href === null) {
    existing?.remove();
    return;
  }
  const tag = existing ?? document.createElement("link");
  tag.setAttribute("rel", "canonical");
  tag.setAttribute("href", href);
  if (!existing) document.head.appendChild(tag);
}

function absolute(pathOrUrl: string): string {
  return new URL(pathOrUrl, window.location.origin).toString();
}

export function useDocumentMeta({
  title,
  description,
  canonical,
  image,
  exactTitle = false,
  noIndex = false,
}: DocumentMeta): void {
  useEffect(() => {
    const fullTitle = exactTitle ? title : `${title} | ${SITE_NAME}`;
    const canonicalUrl = absolute(canonical ?? window.location.pathname);
    const imageUrl = image ? absolute(image) : null;

    document.title = fullTitle;
    upsertCanonical(canonicalUrl);
    upsertMeta("name", "description", description ?? null);
    upsertMeta("name", "robots", noIndex ? "noindex, nofollow" : null);

    upsertMeta("property", "og:site_name", SITE_NAME);
    upsertMeta("property", "og:type", "website");
    upsertMeta("property", "og:title", fullTitle);
    upsertMeta("property", "og:description", description ?? null);
    upsertMeta("property", "og:url", canonicalUrl);
    upsertMeta("property", "og:image", imageUrl);

    upsertMeta(
      "name",
      "twitter:card",
      imageUrl ? "summary_large_image" : "summary",
    );
    upsertMeta("name", "twitter:title", fullTitle);
    upsertMeta("name", "twitter:description", description ?? null);
    upsertMeta("name", "twitter:image", imageUrl);
  }, [title, description, canonical, image, exactTitle, noIndex]);
}
