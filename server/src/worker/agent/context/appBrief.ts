/**
 * What tau tells the agent about an app at the start of a request: the app's
 * memory file, and a map of the app computed from its saved files.
 *
 * ## Why tau hands this over instead of the agent fetching it
 *
 * Every run used to open with `cat .tau/CONTEXT.md`, usually followed by a
 * `list_dir` or two — a turn or more spent, on every request, re-reading what
 * tau already has in its own storage. Sub-agents did the same, each on its own.
 * So tau reads it once and attaches it: to the user's message for the agent,
 * and to the task for a sub-agent.
 *
 * ## Where it goes, and why not the system prompt
 *
 * The memory file changes at the end of nearly every request. The model
 * provider caches a request by its prefix, so anything that changes has to sit
 * as late as possible: in the system prompt it would invalidate the whole
 * conversation each time; on the newest user message it invalidates nothing
 * that was not new anyway. It is attached to the request in progress only —
 * an older request is replayed without it, since a newer copy follows.
 *
 * ## Three parts, on purpose
 *
 *   - **Memory** (`.tau/CONTEXT.md`) is what code cannot say: what the app is
 *     for, why it was built this way, what the user prefers, what is known to
 *     be broken. The agent writes it. It has a fixed set of sections and a size
 *     limit (`memoryProblems`), so it stays something that can be handed over
 *     whole on every request.
 *   - **Design** (`.tau/DESIGN.md`) is how the app should look: the style it
 *     was given, in prose. tau writes it when the app is created
 *     (`worker/design`). Only the prose is sent — the token values live in
 *     `src/index.css` — so a look that takes a page to describe costs about a
 *     thousand tokens a request, and every request builds in the same style.
 *   - **The map** is what code can say: which files exist, which pages are
 *     routed, which API routes and tables are defined. tau computes it, so it
 *     is never stale and nobody has to remember to update it.
 *
 * The parsers here are deliberately shallow — regexes over the two or three
 * files where these things are declared. They can miss unusual code, and the
 * block says so; a wrong map entry costs a file read, not a broken build.
 *
 * Generation 2 only. A generation-1 project's `CONTEXT.md` is mostly a static
 * template manifest and its prompt tells the agent to read it.
 *
 * See doc/CONTEXT_AND_MEMORY_PLAN.md §4.
 */
import { prisma } from "@/lib/prisma";
import { getBlobText } from "@/lib/s3";
import { log } from "@/worker/lib/log";
import { TEMPLATES, toTemplateKey } from "@/worker/templates/registry";
import { MEMORY_MAX_CHARS, MEMORY_PATH, appRelativePath } from "./memoryFile";
import { DESIGN_PATH, designProse } from "@/worker/design/designMd";

export {
  MEMORY_MAX_CHARS,
  MEMORY_PATH,
  MEMORY_SECTIONS,
  appRelativePath,
  isMemoryPath,
  memoryProblems,
} from "./memoryFile";

// ── The map ──────────────────────────────────────────────────────────────────

export interface FileEntry {
  path: string;
  sizeBytes: number;
}

const UI_DIR = "src/components/ui/";
const MAX_MAP_FILES = 150;
const MAX_ROUTES = 80;

/** Files that are tau's, generated, or noise — not part of what the agent works on. */
function isHidden(path: string): boolean {
  return (
    path.startsWith(".tau/") ||
    path.startsWith("node_modules/") ||
    path.startsWith("dist/") ||
    path.startsWith("data/") ||
    path === "bun.lock" ||
    path === "bun.lockb" ||
    path === ".gitignore"
  );
}

function formatSize(bytes: number): string {
  return bytes < 1000 ? `${bytes} B` : `${(bytes / 1000).toFixed(1)} kB`;
}

/** The app's files, one per line, with the shadcn directory folded to a count. */
export function fileMap(files: readonly FileEntry[]): string {
  const visible = files
    .map((f) => ({ ...f, path: appRelativePath(f.path) }))
    .filter((f) => !isHidden(f.path))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const ui = visible.filter((f) => f.path.startsWith(UI_DIR));
  const rest = visible.filter((f) => !f.path.startsWith(UI_DIR));

  const lines = rest
    .slice(0, MAX_MAP_FILES)
    .map((f) => `${f.path}  (${formatSize(f.sizeBytes)})`);
  if (rest.length > MAX_MAP_FILES) {
    lines.push(`… and ${rest.length - MAX_MAP_FILES} more — use list_dir or grep to find them`);
  }
  if (ui.length > 0) {
    lines.push(`${UI_DIR}  (${ui.length} shadcn components)`);
  }
  return lines.join("\n");
}

/** Every `<Route …>` opening tag in `src`, whole — `element={<X />}` included. */
function routeTags(src: string): string[] {
  const tags: string[] = [];
  const re = /<Route\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length;
    let depth = 0;
    let quote: string | null = null;
    for (; i < src.length; i++) {
      const ch = src[i]!;
      if (quote) {
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") quote = ch;
      else if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (ch === ">" && depth === 0) break;
    }
    tags.push(src.slice(m.index, i + 1));
    re.lastIndex = i;
  }
  return tags;
}

/** Component name → the module it is imported from, as written. */
function importsOf(src: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of src.matchAll(
    /import\s+([A-Za-z_]\w*)\s*(?:,\s*\{[^}]*\})?\s*from\s*["']([^"']+)["']/g,
  )) {
    out.set(m[1]!, m[2]!);
  }
  for (const m of src.matchAll(
    /import\s*(?:[A-Za-z_]\w*\s*,\s*)?\{([^}]+)\}\s*from\s*["']([^"']+)["']/g,
  )) {
    for (const part of m[1]!.split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) out.set(name, m[2]!);
    }
  }
  for (const m of src.matchAll(
    /const\s+([A-Za-z_]\w*)\s*=\s*(?:React\.)?lazy\(\s*\(\)\s*=>\s*import\(\s*["']([^"']+)["']\s*\)/g,
  )) {
    out.set(m[1]!, m[2]!);
  }
  return out;
}

/** Resolve an import written in `src/App.tsx` to a saved file, if it is one. */
function resolveImport(spec: string, paths: ReadonlySet<string>): string | null {
  const base = spec.startsWith("@/")
    ? `src/${spec.slice(2)}`
    : spec.startsWith("./")
      ? `src/${spec.slice(2)}`
      : spec.startsWith("../")
        ? spec.slice(3)
        : null;
  if (!base) return null;
  for (const candidate of [
    base,
    `${base}.tsx`,
    `${base}.ts`,
    `${base}.jsx`,
    `${base}.js`,
    `${base}/index.tsx`,
    `${base}/index.ts`,
  ]) {
    if (paths.has(candidate)) return candidate;
  }
  return null;
}

/** The pages routed in `src/App.tsx`, as `path → Component (file)`. */
export function pageRoutes(appTsx: string, paths: ReadonlySet<string>): string[] {
  const imports = importsOf(appTsx);
  const lines: string[] = [];
  for (const tag of routeTags(appTsx)) {
    const path = tag.match(
      /\bpath=(?:"([^"]*)"|'([^']*)'|\{\s*["'`]([^"'`]*)["'`]\s*\})/,
    );
    const where =
      path?.[1] ?? path?.[2] ?? path?.[3] ?? (/\sindex(?=[\s/>=])/.test(tag) ? "(index)" : null);
    const component =
      tag.match(/\belement=\{\s*<\s*([A-Za-z_][\w.]*)/)?.[1] ??
      tag.match(/\bComponent=\{\s*([A-Za-z_]\w*)/)?.[1];
    if (where === null && !component) continue;

    const spec = component ? imports.get(component) : undefined;
    const file = spec ? resolveImport(spec, paths) : null;
    lines.push(
      `${where ?? "(layout)"}${component ? ` → ${component}` : ""}${file ? ` (${file})` : ""}`,
    );
  }
  return lines.slice(0, MAX_ROUTES);
}

/** The routes declared in server files, as `METHOD /path — file`. */
export function apiRoutes(sources: readonly { path: string; text: string }[]): string[] {
  const seen = new Set<string>();
  for (const { path, text } of sources) {
    for (const m of text.matchAll(
      /\b[A-Za-z_]\w*\.(get|post|put|patch|delete|all)\(\s*(["'`])(\/[^"'`\n]*)\2/g,
    )) {
      seen.add(`${m[1]!.toUpperCase()} ${m[3]} — ${path}`);
    }
  }
  return [...seen].slice(0, MAX_ROUTES);
}

/** The tables declared with `pgTable` in a schema file. */
export function tableNames(schemaTs: string): string[] {
  return [
    ...new Set(
      [...schemaTs.matchAll(/pgTable\(\s*["'`]([^"'`]+)["'`]/g)].map((m) => m[1]!),
    ),
  ];
}

// ── The block ────────────────────────────────────────────────────────────────

export interface AppBriefParts {
  /** `.tau/CONTEXT.md`, or null when the app has none saved. */
  memory: string | null;
  /** `.tau/DESIGN.md`, when the app has one. */
  design?: string | null;
  files: readonly FileEntry[];
  /** `src/App.tsx`, when it could be read. */
  appTsx?: string | null;
  /** Server source files outside `server/db/`, when the app has a server. */
  serverSources?: readonly { path: string; text: string }[];
  /** `server/db/schema.ts`, when the app has a database. */
  schemaTs?: string | null;
}

export type BriefAudience =
  /** On the user's message, at the start of a request. */
  | "request"
  /** In `provision_sandbox`'s result, for an app that did not exist until then. */
  | "provisioned"
  /** Ahead of a sub-agent's task. */
  | "sub-agent"
  /** After a summary, with the rest of a run's restored state. */
  | "restored";

const INTRO: Record<BriefAudience, string> = {
  request:
    "What tau knows about this app at the start of this request. You do not need to read `.tau/CONTEXT.md` or list the project to get it.",
  provisioned:
    "The app as it has just been created. You do not need to read `.tau/CONTEXT.md` or list the project to get this.",
  "sub-agent":
    "What tau knows about this app right now. You do not need to read `.tau/CONTEXT.md` or list the project to get it.",
  restored:
    "What tau knows about this app right now, read from its saved files a moment ago — it includes everything this request has done so far. You do not need to read `.tau/CONTEXT.md` or list the project to get it.",
};

/** Render the `<tau_app>` block. Pure. */
export function renderAppBrief(parts: AppBriefParts, audience: BriefAudience): string {
  const paths = new Set(parts.files.map((f) => appRelativePath(f.path)));
  const sections: string[] = [];

  if (parts.memory !== null) {
    const whole = parts.memory.trimEnd();
    if (whole.length > MEMORY_MAX_CHARS) {
      sections.push(
        `<memory file="${MEMORY_PATH}" truncated="true">\n${whole.slice(0, MEMORY_MAX_CHARS)}\n</memory>\nThe memory file is ${whole.length.toLocaleString("en-US")} characters; only the first ${MEMORY_MAX_CHARS.toLocaleString("en-US")} are shown, and that is the limit for the file. Rewrite it shorter during this request.`,
      );
    } else {
      sections.push(
        `<memory file="${MEMORY_PATH}">\n${whole}\n</memory>\nThat is the file exactly as it is saved, so it can be edited without reading it first.`,
      );
    }
  }

  const design = parts.design ? designProse(parts.design) : "";
  if (design) {
    sections.push(
      `<design file="${DESIGN_PATH}">\n${design}\n</design>\nThat is how this app looks. Everything you build or change follows it.`,
    );
  }

  const map = fileMap(parts.files);
  if (map) sections.push(`<files>\n${map}\n</files>`);

  const pages = parts.appTsx ? pageRoutes(parts.appTsx, paths) : [];
  if (pages.length > 0) {
    sections.push(`<pages from="src/App.tsx">\n${pages.join("\n")}\n</pages>`);
  }

  const api = apiRoutes(parts.serverSources ?? []);
  if (api.length > 0) sections.push(`<api_routes>\n${api.join("\n")}\n</api_routes>`);

  const tables = parts.schemaTs ? tableNames(parts.schemaTs) : [];
  if (tables.length > 0) {
    sections.push(`<tables from="server/db/schema.ts">\n${tables.join("\n")}\n</tables>`);
  }

  return `<tau_app>\n${INTRO[audience]} The memory is written by you; the file, page, route and table lists are computed by tau from the saved files and can miss unusual code — the files themselves are the truth.\n\n${sections.join("\n\n")}\n</tau_app>`;
}

// ── Loading ──────────────────────────────────────────────────────────────────

/** Reading a few small files should take well under a second; never hold a run for it. */
const READ_TIMEOUT_MS = 5_000;
const MAX_SERVER_SOURCES = 8;
const MAX_SOURCE_BYTES = 200_000;

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([work.catch(() => null), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read an app's memory and the files its map is computed from.
 *
 * Returns null for a generation-1 project, and for an app with no saved files
 * (it has not been created yet). Never throws: a brief is a convenience, and a
 * run without one still works — the agent reads the file itself.
 */
export async function loadAppBriefParts(projectId: string): Promise<AppBriefParts | null> {
  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { userId: true, templateKey: true },
    });
    if (!project) return null;
    if (TEMPLATES[toTemplateKey(project.templateKey)].generation !== 2) return null;

    const rows = await prisma.projectFile.findMany({
      where: { projectId },
      select: { path: true, contentHash: true, sizeBytes: true },
    });
    if (rows.length === 0) return null;

    const byPath = new Map(rows.map((r) => [appRelativePath(r.path), r]));
    const read = async (path: string): Promise<string | null> => {
      const row = byPath.get(path);
      if (!row || row.sizeBytes > MAX_SOURCE_BYTES) return null;
      return withTimeout(
        getBlobText(project.userId, projectId, row.contentHash),
        READ_TIMEOUT_MS,
      );
    };

    const serverPaths = [...byPath.keys()]
      .filter(
        (p) =>
          p.startsWith("server/") &&
          !p.startsWith("server/db/") &&
          /\.(ts|tsx|js)$/.test(p),
      )
      .sort()
      .slice(0, MAX_SERVER_SOURCES);

    const [memory, design, appTsx, schemaTs, serverTexts] = await Promise.all([
      read(MEMORY_PATH),
      read(DESIGN_PATH),
      read("src/App.tsx"),
      read("server/db/schema.ts"),
      Promise.all(serverPaths.map(read)),
    ]);

    return {
      memory,
      design,
      files: rows,
      appTsx,
      schemaTs,
      serverSources: serverPaths.flatMap((path, i) => {
        const text = serverTexts[i];
        return text ? [{ path, text }] : [];
      }),
    };
  } catch (err) {
    log.warn("app_brief.failed", { projectId, error: String(err) });
    return null;
  }
}

/** The `<tau_app>` block for a project, or null when there is nothing to say. */
export async function loadAppBrief(
  projectId: string,
  audience: BriefAudience,
): Promise<string | null> {
  const parts = await loadAppBriefParts(projectId);
  return parts ? renderAppBrief(parts, audience) : null;
}
