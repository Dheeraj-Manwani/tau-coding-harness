/**
 * Guides the agent is handed at the moment it needs them, instead of carrying
 * them in the system prompt on every turn.
 *
 * Each guide is a markdown file in this directory. They live in tau's own
 * source rather than in the generated project on purpose: a change ships with a
 * normal deploy, reaches every existing project at once, and never ends up in a
 * user's repository. Compare the static half of generation 1's
 * `.tau/CONTEXT.md`, which could only be changed by rebuilding a sandbox image
 * (doc/CONTEXT_AND_MEMORY_PLAN.md §3).
 *
 * Kept as real `.md` files, not string constants, for the same reason
 * `templates/visual-edit/` is real code: they are documents, and are easier to
 * read, diff and review as documents.
 */
import { readFileSync } from "node:fs";

export const DOC_NAMES = ["backend", "database"] as const;

export type DocName = (typeof DOC_NAMES)[number];

const cache = new Map<DocName, string>();

/** A guide's markdown. Read once per process — the files ship with the source. */
export function readDoc(name: DocName): string {
  const cached = cache.get(name);
  if (cached !== undefined) return cached;
  const text = readFileSync(
    new URL(`./${name}.md`, import.meta.url),
    "utf8",
  ).trim();
  cache.set(name, text);
  return text;
}
