import index from "@/src/content/docs-index.json";

/**
 * The generated navigation tree, read once.
 *
 * `docs-index.json` is written by `scripts/build-docs-index.ts` in `predev` and
 * `prebuild`. It is small (the nav half of it is a few KB even at forty pages)
 * and every docs route needs it to render a sidebar, so unlike the search body
 * text it is imported statically rather than fetched.
 */

export interface NavPage {
  path: string;
  slug: string;
  title: string;
  description: string;
}

export interface NavSection {
  slug: string;
  title: string;
  blurb: string;
  pages: NavPage[];
}

interface DocsIndexFile {
  generatedAt: string;
  tree: NavSection[];
  pages: unknown[];
}

const file = index as unknown as DocsIndexFile;

export const NAV_TREE: NavSection[] = file.tree ?? [];

/** Every page in sidebar order: the sequence prev/next walks. */
export const FLAT_PAGES: Array<NavPage & { section: NavSection }> =
  NAV_TREE.flatMap((section) =>
    section.pages.map((page) => ({ ...page, section })),
  );

export function findSection(slug: string): NavSection | undefined {
  return NAV_TREE.find((section) => section.slug === slug);
}

export function findPage(sectionSlug: string, pageSlug: string) {
  return FLAT_PAGES.find(
    (page) => page.section.slug === sectionSlug && page.slug === pageSlug,
  );
}

/** The pages either side of this one, for the footer links. */
export function neighbours(path: string): {
  previous: NavPage | null;
  next: NavPage | null;
} {
  const at = FLAT_PAGES.findIndex((page) => page.path === path);
  if (at === -1) return { previous: null, next: null };
  return {
    previous: FLAT_PAGES[at - 1] ?? null,
    next: FLAT_PAGES[at + 1] ?? null,
  };
}
