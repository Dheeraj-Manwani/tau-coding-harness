/**
 * Builds the docs navigation tree, the search index, and `sitemap.xml`.
 *
 * Runs in `predev` and `prebuild`, so writing a doc is only ever adding a
 * markdown file: no code edit, no registry to keep in sync.
 *
 * Three things come out of one walk:
 *   • the nav tree (section → ordered pages), which the sidebar renders,
 *   • a flat search index of { path, title, description, headings, text },
 *     with body text truncated so the whole thing stays small enough to fetch
 *     lazily the first time someone presses ⌘K, and
 *   • `landing/public/sitemap.xml`, covering static public routes plus every
 *     doc page: from the same walk, so a page can never exist without being
 *     advertised or be advertised without existing (§7).
 *
 * Both outputs are generated, and gitignored. They are build artefacts, not
 * source: committing them would guarantee a stale copy in someone's branch.
 *
 *   bun run scripts/build-docs-index.ts
 */

import { readdirSync, readFileSync, statSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { DOCS_SECTIONS } from "../src/features/docs/sections.ts";
import { STATIC_ROUTES, siteOrigin } from "./public-routes.ts";

// Resolved from this file, not from the working directory: it is invoked from
// `landing/` by that package's predev/prebuild, and from the repo root by hand.
const HERE = dirname(fileURLToPath(import.meta.url));
const CONTENT_ROOT = resolve(HERE, "..", "src", "content");
const CONTENT_DIR = join(CONTENT_ROOT, "docs");
const OUT_FILE = join(CONTENT_ROOT, "docs-index.json");
const PUBLIC_DIR = resolve(HERE, "..", "public");
const SITEMAP_FILE = join(PUBLIC_DIR, "sitemap.xml");

/** Body text kept per page. Enough to match on, small enough to ship. */
const TEXT_BUDGET = 1500;

interface IndexedPage {
  /** Route path, e.g. `/docs/start/quickstart`. */
  path: string;
  section: string;
  slug: string;
  title: string;
  description: string;
  order: number;
  updated: string;
  headings: string[];
  /** Truncated, markdown-stripped body: search only. */
  text: string;
}

/**
 * A deliberately small YAML subset: `key: value` pairs only, with optional
 * quotes. `gray-matter` would do more, but it drags Node polyfills into the
 * browser bundle, and frontmatter here is never more than flat scalars.
 */
function parseFrontmatter(source: string): {
  data: Record<string, string>;
  body: string;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!match) return { data: {}, body: source };

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
  return { data, body: source.slice(match[0].length) };
}

/** Markdown → plain words, for matching. Not a renderer; precision isn't needed. */
function toPlainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^[>\-*+]\s+/gm, " ")
    .replace(/^#{1,6}\s+/gm, " ")
    .replace(/[*_~|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function headingsOf(markdown: string): string[] {
  const found: string[] = [];
  // Fenced code can contain lines starting with #; drop it before scanning.
  const withoutCode = markdown.replace(/```[\s\S]*?```/g, "");
  for (const line of withoutCode.split(/\r?\n/)) {
    const match = /^(#{2,3})\s+(.+?)\s*$/.exec(line);
    if (match) found.push(match[2]!);
  }
  return found;
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith(".md")) out.push(full);
  }
  return out;
}

const files = walk(CONTENT_DIR);
const pages: IndexedPage[] = [];
const problems: string[] = [];

for (const file of files) {
  const relative = file.slice(CONTENT_DIR.length + 1).split(sep);
  if (relative.length !== 2) {
    problems.push(`${file}: expected content/docs/<section>/<slug>.md`);
    continue;
  }
  const [section, filename] = relative as [string, string];
  const slug = filename.replace(/\.md$/, "");

  const source = readFileSync(file, "utf8");
  const { data, body } = parseFrontmatter(source);

  if (!data["title"]) {
    problems.push(`${file}: missing frontmatter \`title\``);
    continue;
  }
  if (!DOCS_SECTIONS.some((s) => s.slug === section)) {
    problems.push(
      `${file}: section "${section}" is not in features/docs/sections.ts`,
    );
    continue;
  }

  pages.push({
    path: `/docs/${section}/${slug}`,
    section,
    slug,
    title: data["title"]!,
    description: data["description"] ?? "",
    order: Number(data["order"] ?? 999),
    updated: data["updated"] ?? "",
    headings: headingsOf(body),
    text: toPlainText(body).slice(0, TEXT_BUDGET),
  });
}

if (problems.length > 0) {
  console.error("[docs-index] refusing to build:");
  for (const problem of problems) console.error(`  • ${problem}`);
  process.exit(1);
}

pages.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));

const tree = DOCS_SECTIONS.map((section) => ({
  slug: section.slug,
  title: section.title,
  blurb: section.blurb,
  pages: pages
    .filter((page) => page.section === section.slug)
    .map(({ path, slug, title, description }) => ({
      path,
      slug,
      title,
      description,
    })),
})).filter((section) => section.pages.length > 0);

mkdirSync(CONTENT_ROOT, { recursive: true });
writeFileSync(
  OUT_FILE,
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString().slice(0, 10),
      tree,
      pages,
    },
    null,
    2,
  )}\n`,
);

const bytes = readFileSync(OUT_FILE).byteLength;
console.error(
  `[docs-index] ${pages.length} pages across ${tree.length} sections → ` +
    `${(bytes / 1024).toFixed(1)}KB (uncompressed)`,
);

// ── sitemap.xml ───────────────────────────────────────────────────────────────

const ORIGIN = siteOrigin();
const TODAY = new Date().toISOString().slice(0, 10);

/**
 * A doc page's `<lastmod>` is its frontmatter `updated`, not the file's mtime:
 * mtime moves on a checkout or a reformat, and telling a crawler a page changed
 * when its content didn't is how a sitemap stops being trusted.
 */
function lastmodOf(page: IndexedPage): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(page.updated) ? page.updated : TODAY;
}

function urlEntry(
  path: string,
  lastmod: string,
  changefreq: string,
  priority: number,
): string {
  return [
    "  <url>",
    `    <loc>${ORIGIN}${path}</loc>`,
    `    <lastmod>${lastmod}</lastmod>`,
    `    <changefreq>${changefreq}</changefreq>`,
    `    <priority>${priority.toFixed(1)}</priority>`,
    "  </url>",
  ].join("\n");
}

const sitemapEntries = [
  ...STATIC_ROUTES.map((route) =>
    urlEntry(route.path, TODAY, route.changefreq, route.priority),
  ),
  // Docs are the long tail and the reason the sitemap exists at all: without it
  // a client-rendered SPA's 41 doc pages are reachable only by crawling links.
  ...pages.map((page) =>
    urlEntry(page.path, lastmodOf(page), "monthly", 0.7),
  ),
];

mkdirSync(PUBLIC_DIR, { recursive: true });
writeFileSync(
  SITEMAP_FILE,
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapEntries.join("\n")}
</urlset>
`,
);

console.error(
  `[sitemap] ${sitemapEntries.length} urls → landing/public/sitemap.xml (${ORIGIN})`,
);
