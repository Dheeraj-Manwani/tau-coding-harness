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
 *
 * ## How a guide reaches the model
 *
 * Three ways, in order of how little they depend on the model choosing well:
 *
 *   1. **Returned by a tool.** `add_backend`, `add_database` and `enable_ai`
 *      set an area up and return its guide in the same result.
 *   2. **Attached by tau.** The first time the agent opens or changes a file a
 *      guide covers, or first uses a tool it explains, the guide rides along on
 *      that tool's result (`delivery.ts`). No decision by the model involved.
 *   3. **Asked for.** `read_doc(name)`, guided by the index in `tau.md`.
 *
 * `DOCS` below is the one place that says which guide is which: the index line
 * the model sees, and what attaches it. The index in the system prompt is
 * generated from it, so the two cannot drift.
 */
import { readFileSync } from "node:fs";

export const DOC_NAMES = [
  "backend",
  "database",
  "ai",
  "secrets",
  "theme",
  "layouts",
  "data",
  "restyle",
  "components",
  "motion",
  "assets",
  "github",
] as const;

export type DocName = (typeof DOC_NAMES)[number];

export function isDocName(value: unknown): value is DocName {
  return typeof value === "string" && (DOC_NAMES as readonly string[]).includes(value);
}

interface DocSpec {
  /**
   * The guide's line in the index: *when* to read it, not what it contains.
   * A model decides whether to open a guide from this line alone.
   */
  when: string;
  /**
   * Project files the guide covers, as paths relative to the app root. Opening
   * or changing one attaches the guide.
   */
  covers?: (path: string) => boolean;
  /** Tools whose first result in a conversation carries the guide. */
  firstUseOf?: readonly string[];
}

export const DOCS: Record<DocName, DocSpec> = {
  backend: {
    when: "before adding or changing an API route, or any file under `server/`. Returned by `add_backend`.",
    covers: (p) => p.startsWith("server/") && !p.startsWith("server/db/"),
  },
  database: {
    when: "before adding or changing a table or a query. Returned by `add_database`.",
    covers: (p) => p.startsWith("server/db/"),
  },
  ai: {
    when: "before writing code that calls a language model. Returned by `enable_ai`, which has to be called first — reading the guide alone turns nothing on.",
  },
  secrets: {
    when: "before building anything that needs a key for an outside service (Stripe, Resend, maps, …).",
    firstUseOf: ["request_secret"],
  },
  theme: {
    when: "before changing colors, typefaces, roundness, shadows, or light and dark mode — anything in `src/index.css`.",
    covers: (p) => p === "src/index.css",
  },
  layouts: {
    when: "before building or restructuring a page or a screen.",
    // The files a screen is made of. `src/App.tsx` is in here on purpose: it is
    // the first file an agent opens before building anything, so the guide is
    // in hand before the first screen is written.
    covers: (p) =>
      p === "src/App.tsx" ||
      p.startsWith("src/pages/") ||
      (p.startsWith("src/components/") && !p.startsWith("src/components/ui/")),
  },
  data: {
    when: "before building a dashboard, a report, a chart or a table of records.",
    // Screens named for what the guide covers. A dashboard that is the app's
    // home page is not caught, and is what the index line is for.
    covers: (p) =>
      /^src\/(pages|components)\/(?!ui\/).*(dashboard|report|analytic|table|chart|stats|metric|overview)/i.test(p),
  },
  restyle: {
    when: "before bringing the screens in line with a style the user has just changed. The request that asks for it says to read this.",
  },
  components: {
    when: "before using a shadcn component — they are built on Base UI here, so there is no `asChild`, and `Select` needs its labels.",
    // Arrives with `layouts`, on the first file of a screen, and again for
    // anyone who opens a component file to find out how it works: an agent
    // that does that has already lost turns this guide would have saved.
    covers: (p) =>
      p === "src/App.tsx" ||
      p.startsWith("src/pages/") ||
      p.startsWith("src/components/"),
  },
  motion: {
    when: "before adding animation or transitions beyond a simple hover state.",
  },
  assets: {
    when: "before adding real images: photos, backgrounds, logos.",
    firstUseOf: ["search_images"],
  },
  github: {
    when: "before pushing to GitHub, opening a pull request, or filing an issue.",
    // The guide is wanted before the first push, and nothing happens before a
    // push that tau could hang it on — so this one depends on the agent asking.
    // A smaller model does not always ask (it went straight to the tool in a
    // real run). Attaching it to the first successful push at least puts the
    // follow-up rules (`update_pr`, not a new pull request each time) in front
    // of the agent before the second.
    firstUseOf: ["push_to_github", "create_github_issue"],
  },
};

const cache = new Map<string, string>();

function readMarkdown(file: string): string {
  const cached = cache.get(file);
  if (cached !== undefined) return cached;
  const text = readFileSync(new URL(`./${file}.md`, import.meta.url), "utf8")
    // A checkout on Windows may hand back CRLF; the model should get the same
    // bytes wherever the server runs, or the provider's cache would not match.
    .replace(/\r\n/g, "\n")
    .trim();
  cache.set(file, text);
  return text;
}

/** A guide's markdown. Read once per process — the files ship with the source. */
export function readDoc(name: DocName): string {
  return readMarkdown(name);
}

/**
 * `tau.md`: the system prompt for a generation-2 project, with `{{…}}` slots
 * that `tauPrompt.ts` fills in. Not a guide — it is what is always in context.
 */
export function readTauTemplate(): string {
  return readMarkdown("tau");
}

/** The index of guides as it appears in the system prompt, one line each. */
export function docIndex(): string {
  return DOC_NAMES.map((name) => `- \`${name}\` — ${DOCS[name].when}`).join("\n");
}

// ── Guides inside tool results ───────────────────────────────────────────────

const MARKER_PREFIX = "[tau guide: ";

/**
 * A guide as it is put into a tool result: its text under a one-line marker.
 *
 * The marker is how tau later knows the guide is in the conversation — so it
 * is not attached a second time — and how a guide is recognised and kept when
 * the result around it is cleared from the context (`context/clearing.ts`).
 */
export function guideText(name: DocName): string {
  return `${MARKER_PREFIX}${name}]\n${readDoc(name)}`;
}

/** Whether `text` might carry a guide. Cheap; used to skip the real check. */
export function mentionsGuide(text: string): boolean {
  return text.includes(MARKER_PREFIX);
}

/** Every guide whose marker appears in `text`. */
export function guidesIn(text: string): DocName[] {
  if (!mentionsGuide(text)) return [];
  const found = new Set<DocName>();
  for (const match of text.matchAll(/\[tau guide: ([a-z-]+)\]/g)) {
    if (isDocName(match[1])) found.add(match[1]);
  }
  return [...found];
}

/**
 * The guides a stored tool result carries, as plain text — what is kept when
 * the rest of the result is cleared.
 *
 * A result is the JSON of an object, and a guide is always one of its top-level
 * string fields (`guide`, `recipe`, `attachedGuide`, …). Anything else comes
 * back as "".
 */
export function carriedGuides(resultContent: string): string {
  if (!mentionsGuide(resultContent)) return "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(resultContent);
  } catch {
    return "";
  }
  if (!parsed || typeof parsed !== "object") return "";
  return Object.values(parsed as Record<string, unknown>)
    .filter((v): v is string => typeof v === "string" && v.startsWith(MARKER_PREFIX))
    .join("\n\n");
}

// ── What attaches a guide ────────────────────────────────────────────────────

/** `./src/x`, `/home/user/app/src/x` and `src/x` are the same file. */
function appRelative(path: string): string {
  return path
    .trim()
    .replace(/^\/home\/user\/app\//, "")
    .replace(/^\.\//, "");
}

/** Guides that cover the file at `path`. */
export function docsForPath(path: string): DocName[] {
  const rel = appRelative(path);
  return DOC_NAMES.filter((name) => DOCS[name].covers?.(rel) ?? false);
}

/** Guides that explain how to use `tool`. */
export function docsForTool(tool: string): DocName[] {
  return DOC_NAMES.filter((name) => DOCS[name].firstUseOf?.includes(tool) ?? false);
}
