/**
 * The docs' top-level sections (§6).
 *
 * Order here is the order they appear in the sidebar and on `/docs`. Pages
 * inside a section are ordered by their frontmatter `order`, resolved at build
 * time by `scripts/build-docs-index.ts`: this file only knows about sections,
 * so adding a page never means editing code.
 *
 * Shared with the index builder, which imports it to lay the tree out in the
 * same order the UI will render it.
 */

export interface DocsSection {
  slug: string;
  title: string;
  /** One line, shown on the `/docs` pillar card. */
  blurb: string;
}

export const DOCS_SECTIONS: DocsSection[] = [
  {
    slug: "start",
    title: "Getting started",
    blurb: "What tau is, and how to get your first app running.",
  },
  {
    slug: "build",
    title: "Building",
    blurb: "Writing prompts, choosing effort, and iterating on a build.",
  },
  {
    slug: "workspace",
    title: "The workspace",
    blurb: "Chat, files, the editor, and the live preview.",
  },
  {
    slug: "ship",
    title: "Shipping",
    blurb: "GitHub, secrets, and getting your code out.",
  },
  {
    slug: "ai",
    title: "AI gateway",
    blurb: "Letting the app tau builds you call an LLM.",
  },
  {
    slug: "billing",
    title: "Credits & billing",
    blurb: "What a credit is, what things cost, and every limit.",
  },
  {
    slug: "mobile",
    title: "Mobile",
    blurb: "What the app does, and what it deliberately doesn't.",
  },
  {
    slug: "reference",
    title: "Reference",
    blurb: "Agent tools, limits, errors, and the public HTTP surface.",
  },
  {
    slug: "help",
    title: "Help",
    blurb: "Troubleshooting, FAQ, and how to reach a human.",
  },
];

export function sectionBySlug(slug: string): DocsSection | undefined {
  return DOCS_SECTIONS.find((section) => section.slug === slug);
}
