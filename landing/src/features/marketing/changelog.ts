/**
 * Loads the changelog entries.
 *
 * Same pipeline as the docs (`features/docs/loader.ts`): markdown in
 * `content/changelog/`, flat-scalar frontmatter, `import.meta.glob` per file.
 * Writing an entry is adding a file.
 *
 * Unlike docs, every entry renders on one page: a changelog is read by
 * scrolling, not by navigating: so this loads all of them at once. That is
 * affordable because entries are short and there is no per-entry route to
 * code-split against. Revisit if the corpus gets long enough that the page
 * itself becomes the cost.
 */

import { parseFrontmatterFields } from "@/src/features/docs/loader";

const MODULES = import.meta.glob("../../content/changelog/*.md", {
  query: "?raw",
  import: "default",
}) as Record<string, () => Promise<string>>;

export interface ChangelogEntry {
  /** ISO date, `YYYY-MM-DD`. Also the sort key. */
  date: string;
  title: string;
  /** Anchor id, derived from the filename so a permalink survives a retitle. */
  id: string;
  body: string;
}

function idOf(modulePath: string): string {
  return modulePath.replace(/^.*\//, "").replace(/\.md$/, "");
}

/** Newest first. Entries missing a frontmatter `date` sort last. */
export async function loadChangelog(): Promise<ChangelogEntry[]> {
  const entries = await Promise.all(
    Object.entries(MODULES).map(async ([modulePath, load]) => {
      const { data, body } = parseFrontmatterFields(await load());
      return {
        date: data["date"] ?? "",
        title: data["title"] ?? "",
        id: idOf(modulePath),
        body,
      };
    }),
  );

  return entries.sort((a, b) => b.date.localeCompare(a.date));
}
