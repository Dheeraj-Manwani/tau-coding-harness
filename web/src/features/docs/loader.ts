/**
 * Loads one doc's markdown, on demand.
 *
 * `import.meta.glob` without `eager` gives Vite a module per file, so a docs
 * page fetches only its own body — the difference between a docs site that
 * ships every page to every visitor and one that doesn't. It also means adding
 * a page needs no registration: the glob picks it up.
 */

const MODULES = import.meta.glob("../../content/docs/**/*.md", {
  query: "?raw",
  import: "default",
}) as Record<string, () => Promise<string>>;

export interface DocFrontmatter {
  title: string;
  description?: string;
  updated?: string;
  order?: number;
}

export interface LoadedDoc {
  frontmatter: DocFrontmatter;
  body: string;
}

/**
 * The same flat-scalar YAML subset the index builder parses, kept in step with
 * it deliberately. Pulling in `gray-matter` for this would drag Node polyfills
 * into the browser bundle to read four keys.
 */
export function parseFrontmatter(source: string): LoadedDoc {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!match) return { frontmatter: { title: "" }, body: source };

  const data: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const pair = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line.trim());
    if (!pair) continue;
    let value = pair[2]!.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    data[pair[1]!] = value;
  }

  return {
    frontmatter: {
      title: data["title"] ?? "",
      description: data["description"],
      updated: data["updated"],
      order: data["order"] ? Number(data["order"]) : undefined,
    },
    body: source.slice(match[0].length),
  };
}

export function docExists(section: string, slug: string): boolean {
  return `../../content/docs/${section}/${slug}.md` in MODULES;
}

/** Resolves to `null` when there is no such page, so the caller can 404. */
export async function loadDoc(
  section: string,
  slug: string,
): Promise<LoadedDoc | null> {
  const key = `../../content/docs/${section}/${slug}.md`;
  const load = MODULES[key];
  if (!load) return null;
  return parseFrontmatter(await load());
}

/** Rough reading time, in whole minutes, never less than one. */
export function readingMinutes(body: string): number {
  const words = body.trim().split(/\s+/).length;
  return Math.max(1, Math.round(words / 220));
}

export interface TocEntry {
  id: string;
  text: string;
  level: 2 | 3;
}

/**
 * The right-rail contents.
 *
 * Derived from the markdown source rather than from the rendered DOM: the ToC
 * can then render in the same paint as the body instead of appearing a frame
 * later, and it cannot disagree with what `rehype-slug` produced because both
 * slugify the same way.
 */
export function tableOfContents(body: string): TocEntry[] {
  const withoutCode = body.replace(/```[\s\S]*?```/g, "");
  const entries: TocEntry[] = [];
  for (const line of withoutCode.split(/\r?\n/)) {
    const match = /^(#{2,3})\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    const text = match[2]!.replace(/[`*_]/g, "");
    entries.push({
      id: slugify(text),
      text,
      level: match[1]!.length === 2 ? 2 : 3,
    });
  }
  return entries;
}

/** Mirrors github-slugger, which is what `rehype-slug` uses. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");
}
