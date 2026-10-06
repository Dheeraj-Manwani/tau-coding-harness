/**
 * The rules for an app's memory file, `.tau/CONTEXT.md`, on a generation-2
 * project: where it is, which sections it always has, and how big it may get.
 *
 * Separate from `appBrief.ts`, which reads the file out of storage, so that
 * the system prompt can quote these rules without importing a database client.
 * The template writes the file empty (`buildAppMemoryMd` in
 * `templates/shared.ts`), the prompt tells the agent to keep it to this shape
 * (`docs/tau.md`), and the loop checks that it did (`memoryNudge` in
 * `loop.ts`) — all three read the same constants.
 *
 * Pure. See doc/CONTEXT_AND_MEMORY_PLAN.md §4.
 */
export const MEMORY_PATH = ".tau/CONTEXT.md";

/** The memory file is handed over whole on every request, so it has to stay small. */
export const MEMORY_MAX_CHARS = 6_000;

/**
 * The sections the memory file always has, in order. The template writes them
 * empty (`buildAppMemoryMd`); the agent fills them in and keeps them.
 */
export const MEMORY_SECTIONS = [
  "## What this app is",
  "## Routes and where they live",
  "## Data model",
  "## Decisions and why",
  "## User preferences",
  "## Known issues",
] as const;

/** `./x`, `/home/user/app/x` and `x` are the same file. */
export function appRelativePath(path: string): string {
  return path
    .trim()
    .replace(/^\/home\/user\/app\//, "")
    .replace(/^\.\//, "");
}

export function isMemoryPath(path: unknown): boolean {
  return typeof path === "string" && appRelativePath(path) === MEMORY_PATH;
}

/**
 * What is wrong with a memory file, in words the agent can act on. Empty when
 * nothing is.
 */
export function memoryProblems(content: string): string[] {
  const problems: string[] = [];
  if (content.length > MEMORY_MAX_CHARS) {
    problems.push(
      `it is ${content.length.toLocaleString("en-US")} characters and the limit is ${MEMORY_MAX_CHARS.toLocaleString("en-US")} — tighten it: one or two lines per item, no history of what changed when`,
    );
  }
  const missing = MEMORY_SECTIONS.filter((s) => !content.includes(s));
  if (missing.length > 0) {
    problems.push(
      `it is missing ${missing.length === 1 ? "the section" : "the sections"} ${missing.map((s) => `"${s}"`).join(", ")} — keep all six, and write "_None yet._" under one with nothing to say`,
    );
  }
  return problems;
}
