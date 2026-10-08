/**
 * Turning what a browser saw while an app loaded into something a model can
 * read: a verdict, and the few lines that explain it.
 *
 * `previewInspect.ts` drives the browser and collects raw events. Everything
 * here is pure — no browser, no network — because this is the part with the
 * judgement in it (what counts as broken, what is noise, how much to keep) and
 * judgement is what needs tests.
 *
 * The report goes into a model's context and is re-read on every later step of
 * the run, so it is built to be small: sandbox URLs cut down to app paths,
 * repeats merged, library stack frames collapsed, every list capped.
 *
 * See doc/PREVIEW_DIAGNOSTICS_PLAN.md §3.1.
 */

// ── What the browser collected ───────────────────────────────────────────────

export interface RawFrame {
  fn: string;
  url: string;
  /** 1-based. */
  line: number;
  /** 1-based. */
  col: number;
}

export interface RawException {
  message: string;
  frames: RawFrame[];
}

export interface RawConsole {
  level: "error" | "warning" | "info" | "log" | "debug";
  text: string;
  url?: string;
  line?: number;
}

export interface RawRequest {
  method: string;
  url: string;
  /** `Document`, `Script`, `XHR`, `Fetch`, `Image`, … as the browser names it. */
  type: string;
  status?: number;
  /** Why it never got a response, in the browser's words. */
  errorText?: string;
  /** The start of the response, when it failed and was worth reading. */
  body?: string;
  /** The lines of source around a compile error, when the dev server gave them. */
  frame?: string;
}

/** Vite's error overlay, as the three parts tau's runtime also reads. */
export interface RawOverlay {
  message: string;
  file?: string;
  frame?: string;
}

export interface RawDom {
  title: string;
  /** No `#root` / `#app`, or it has nothing in it. */
  rootEmpty: boolean;
  visibleText: string;
  headings: string[];
  overlay: RawOverlay | null;
}

export interface RawInspection {
  /** The preview's origin, e.g. `https://5173-abc.e2b.app`. */
  origin: string;
  /** The route that was opened. */
  path: string;
  /** Status of the page's own document, when it answered at all. */
  httpStatus?: number;
  /** Why navigation failed, in the browser's words. */
  navigationError?: string;
  /** The inspection ran out of time before the page settled. */
  timedOut?: boolean;
  exceptions: RawException[];
  console: RawConsole[];
  requests: RawRequest[];
  /** Null when the page never got far enough to be read. */
  dom: RawDom | null;
  /** Steps that could not be done, in words. */
  stepsFailed: string[];
}

// ── The report ───────────────────────────────────────────────────────────────

export type PreviewStatus =
  | "rendered"
  | "rendered_with_errors"
  | "blank"
  | "crashed"
  | "build_error"
  | "unreachable";

export interface ReportException {
  message: string;
  /** Where in the app's own code, when a frame of the stack is there. */
  at?: string;
  /**
   * Where it was thrown, when no frame of the stack is in the app's own code:
   * a package the app uses, or the dev server's own script in the page.
   */
  thrownIn?: string;
  /**
   * It was thrown by the dev tooling's own code in the page (`@vite/client`
   * and the like), not by the app or anything the app imports.
   */
  devTooling?: boolean;
  stack?: string[];
  count: number;
}

export interface ReportConsole {
  level: string;
  text: string;
  at?: string;
  count: number;
}

export interface ReportRequest {
  method: string;
  url: string;
  status?: number;
  error?: string;
  body?: string;
  count?: number;
}

export interface PreviewReport {
  path: string;
  status: PreviewStatus;
  summary: string;
  /** What to do about it. Absent when there is nothing to do. */
  next?: string;
  document: { httpStatus?: number; title?: string };
  rendered?: { visibleText: string; headings: string[] };
  buildError?: RawOverlay;
  exceptions?: ReportException[];
  console?: ReportConsole[];
  network?: { requests: number; failed: ReportRequest[] };
  stepsFailed?: string[];
  /** How many entries each capped list left out. */
  omitted?: Record<string, number>;
  /** A caveat about the stack positions, when there are any. */
  note?: string;
}

export const MAX_EXCEPTIONS = 5;
export const MAX_CONSOLE = 15;
export const MAX_FAILED_REQUESTS = 10;
const MAX_APP_FRAMES = 6;
const MAX_MESSAGE_CHARS = 400;
const MAX_CONSOLE_CHARS = 300;
export const MAX_BODY_CHARS = 500;
const MAX_BUILD_ERROR_CHARS = 1_500;
const MAX_VISIBLE_TEXT_CHARS = 300;

/** The statuses that mean the user is looking at nothing. */
export function isBroken(status: PreviewStatus): boolean {
  return status === "blank" || status === "crashed" || status === "build_error";
}

// ── URLs ─────────────────────────────────────────────────────────────────────

/** Query parameters Vite adds to what it serves. They change on every edit. */
const VITE_PARAMS = new Set(["t", "v", "import", "direct", "url", "raw", "html-proxy", "tsr-split"]);

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/**
 * A URL as the agent should see it. One on the preview's own origin becomes a
 * path: `https://5173-abc.e2b.app/src/App.tsx?t=17…` is `src/App.tsx`, the name
 * its file tools take, and `/api/items?page=2` stays a route. Anything else is
 * left whole, without its query.
 */
export function shortUrl(url: string, origin: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url, origin);
  } catch {
    return clip(url, 160);
  }
  if (parsed.origin !== new URL(origin).origin) {
    return clip(`${parsed.origin}${parsed.pathname}`, 160);
  }
  let path = parsed.pathname;
  // `/@fs/home/user/app/src/x.ts` is Vite's way to serve a file by its full path.
  path = path.replace(/^\/@fs\/home\/user\/app\//, "/");
  const kept = [...parsed.searchParams.entries()].filter(([k]) => !VITE_PARAMS.has(k));
  const query = kept.length > 0 ? `?${kept.map(([k, v]) => (v ? `${k}=${v}` : k)).join("&")}` : "";
  const isFile = /^\/(src|node_modules|public|server|@vite|@react-refresh|@id)\b/.test(path);
  return clip(isFile ? `${path.slice(1)}${query}` : `${path}${query}`, 160);
}

/** Every mention of the preview's origin in free text, cut down the same way. */
export function shortenIn(text: string, origin: string): string {
  const base = new URL(origin).origin;
  return text
    .split(base)
    .join("")
    .replace(/(\/[\w@./-]+)\?(?:t|v)=[\w.-]+/g, "$1")
    .replace(/(^|[\s(])\/(src\/)/g, "$1$2");
}

function isLibraryUrl(url: string, origin: string): boolean {
  const short = shortUrl(url, origin);
  return (
    !url ||
    short.startsWith("node_modules/") ||
    short.startsWith("@vite") ||
    short.startsWith("@react-refresh") ||
    short.startsWith("@id") ||
    /^https?:\/\//.test(short)
  );
}

/**
 * Code the dev server puts in the page for its own purposes: its client, the
 * refresh runtime, its virtual modules, Vite's own files. Not the app, and not
 * a package the app imports (those are served from `node_modules/.vite/deps`).
 * An error thrown here is about the tooling, and no edit to the app fixes it.
 */
function isDevToolingUrl(url: string, origin: string): boolean {
  const short = shortUrl(url, origin);
  return (
    short.startsWith("@vite") ||
    short.startsWith("@react-refresh") ||
    short.startsWith("@id/") ||
    short.startsWith("node_modules/vite/")
  );
}

// ── Exceptions ───────────────────────────────────────────────────────────────

function frameText(frame: RawFrame, origin: string): string {
  const where = `${shortUrl(frame.url, origin)}:${frame.line}:${frame.col}`;
  return frame.fn ? `${frame.fn} (${where})` : where;
}

/**
 * A stack for reading: the frames in the app's own files, with each run of
 * library frames in between replaced by one line.
 *
 * Unless there are no frames in the app's files at all. Then the frame it was
 * thrown in is the only thing the stack has to say, and it is kept: a stack
 * reduced to "1 frame in libraries" tells the reader an error happened
 * somewhere, which they knew. (It did exactly that for an error in
 * `@vite/client`, and the agent spent forty tool calls finding the file.)
 */
export function compactStack(frames: readonly RawFrame[], origin: string): string[] {
  if (frames.length > 0 && frames.every((f) => isLibraryUrl(f.url, origin))) {
    const top = frames.find((f) => f.url);
    if (!top) return [];
    const rest = frames.length - 1;
    return [
      frameText(top, origin),
      ...(rest > 0 ? [`… ${rest} more frame${rest === 1 ? "" : "s"} in libraries`] : []),
    ];
  }
  const out: string[] = [];
  let library = 0;
  let app = 0;
  const flush = () => {
    if (library > 0) out.push(`… ${library} frame${library === 1 ? "" : "s"} in libraries`);
    library = 0;
  };
  for (const frame of frames) {
    if (isLibraryUrl(frame.url, origin)) {
      library++;
      continue;
    }
    if (app >= MAX_APP_FRAMES) {
      library++;
      continue;
    }
    flush();
    out.push(frameText(frame, origin));
    app++;
  }
  flush();
  return out;
}

function reportExceptions(
  raw: readonly RawException[],
  origin: string,
): { list: ReportException[]; omitted: number } {
  const merged = new Map<string, ReportException>();
  for (const ex of raw) {
    const message = clip(shortenIn(ex.message, origin), MAX_MESSAGE_CHARS);
    const first = ex.frames.find((f) => !isLibraryUrl(f.url, origin));
    const at = first ? `${shortUrl(first.url, origin)}:${first.line}:${first.col}` : undefined;
    // With no frame in the app, the frame it was thrown in is what there is.
    const top = first ? undefined : ex.frames.find((f) => f.url);
    const thrownIn = top ? `${shortUrl(top.url, origin)}:${top.line}:${top.col}` : undefined;
    const devTooling = top ? isDevToolingUrl(top.url, origin) : false;
    const key = `${message}\n${at ?? thrownIn ?? ""}`;
    const seen = merged.get(key);
    if (seen) {
      seen.count++;
      continue;
    }
    const stack = compactStack(ex.frames, origin);
    merged.set(key, {
      message,
      ...(at ? { at } : {}),
      ...(thrownIn ? { thrownIn } : {}),
      ...(devTooling ? { devTooling } : {}),
      ...(stack.length > 0 ? { stack } : {}),
      count: 1,
    });
  }
  const all = [...merged.values()];
  return { list: all.slice(0, MAX_EXCEPTIONS), omitted: Math.max(0, all.length - MAX_EXCEPTIONS) };
}

// ── Console ──────────────────────────────────────────────────────────────────

/**
 * A console call as the console would print it. `console.error("%s failed: %o",
 * name, err)` arrives as three arguments; a reader wants one line. `%c` and the
 * style that follows it are dropped, since they only colour the text.
 */
export function formatConsoleArgs(args: readonly string[]): string {
  const [first, ...rest] = args;
  if (first === undefined) return "";
  if (!/%[sdifoOc]/.test(first)) return args.join(" ");
  const left = [...rest];
  const text = first.replace(/%([sdifoOc%])/g, (whole, kind: string) => {
    if (kind === "%") return "%";
    if (left.length === 0) return whole;
    const value = left.shift()!;
    return kind === "c" ? "" : value;
  });
  return [text, ...left].join(" ");
}

/** Lines every Vite + React app logs, which say nothing about this one. */
const CONSOLE_NOISE = [
  /^\[vite\]/i,
  /Download the React DevTools/i,
  /^\[HMR\]/i,
  /React Router Future Flag Warning/i,
];

function reportConsole(
  raw: readonly RawConsole[],
  origin: string,
  verbose: boolean,
): { list: ReportConsole[]; omitted: number } {
  const merged = new Map<string, ReportConsole>();
  for (const entry of raw) {
    const loud = entry.level === "error" || entry.level === "warning";
    if (!loud && !verbose) continue;
    if (CONSOLE_NOISE.some((re) => re.test(entry.text))) continue;
    const text = clip(shortenIn(entry.text, origin), MAX_CONSOLE_CHARS);
    if (!text) continue;
    const key = `${entry.level}\n${text}`;
    const seen = merged.get(key);
    if (seen) {
      seen.count++;
      continue;
    }
    const at =
      entry.url && !isLibraryUrl(entry.url, origin)
        ? `${shortUrl(entry.url, origin)}${entry.line ? `:${entry.line}` : ""}`
        : undefined;
    merged.set(key, { level: entry.level, text, ...(at ? { at } : {}), count: 1 });
  }
  // Errors first: when the list is cut, it is the warnings that go.
  const rank = (level: string) => (level === "error" ? 0 : level === "warning" ? 1 : 2);
  const all = [...merged.values()].sort((a, b) => rank(a.level) - rank(b.level));
  return { list: all.slice(0, MAX_CONSOLE), omitted: Math.max(0, all.length - MAX_CONSOLE) };
}

// ── Network ──────────────────────────────────────────────────────────────────

/** A request the browser gave up on because the page moved on. Not a fault. */
function isAborted(request: RawRequest): boolean {
  return /ERR_ABORTED|ERR_CACHE_MISS/i.test(request.errorText ?? "");
}

function sameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url, origin).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

export function failedRequests(raw: readonly RawRequest[]): RawRequest[] {
  return raw.filter((r) => {
    if (r.type === "Document") return false; // reported as the document's status
    if (isAborted(r)) return false;
    // Browsers ask for this by themselves; an app without one is not broken.
    if (/\/favicon\.ico(\?|$)/.test(r.url)) return false;
    // The dev server's own socket: nothing the app's code can fix.
    if (r.type === "WebSocket" || r.type === "Ping") return false;
    return (r.status !== undefined && r.status >= 400) || Boolean(r.errorText);
  });
}

function reportRequests(
  raw: readonly RawRequest[],
  origin: string,
): { list: ReportRequest[]; omitted: number } {
  const merged = new Map<string, ReportRequest>();
  for (const r of failedRequests(raw)) {
    const url = shortUrl(r.url, origin);
    const key = `${r.method} ${url} ${r.status ?? r.errorText}`;
    const seen = merged.get(key);
    if (seen) {
      seen.count = (seen.count ?? 1) + 1;
      continue;
    }
    merged.set(key, {
      method: r.method,
      url,
      ...(r.status !== undefined ? { status: r.status } : {}),
      ...(r.errorText ? { error: clip(r.errorText, 120) } : {}),
      ...(r.body ? { body: clip(shortenIn(r.body, origin), MAX_BODY_CHARS) } : {}),
    });
  }
  const all = [...merged.values()];
  return {
    list: all.slice(0, MAX_FAILED_REQUESTS),
    omitted: Math.max(0, all.length - MAX_FAILED_REQUESTS),
  };
}

// ── The verdict ──────────────────────────────────────────────────────────────

/**
 * Which file the overlay blames: the path only, as the agent's tools take it.
 *
 * The line the overlay puts after it is dropped on purpose. It frequently
 * belongs to Vite's own bundle rather than to the source — a real run reported
 * `src/App.tsx:7581:23` for a thirty-line file — and a confidently wrong line
 * is worse than none. The message carries the true position.
 */
function overlayFile(file: string): string {
  return file
    .trim()
    .replace(/^\/home\/user\/app\//, "")
    .replace(/(:\d+)+$/, "");
}

/**
 * A compiler's message without its drawing. The newer parsers frame the
 * offending line with box characters and arrows, which read well in a terminal
 * and are noise once the message is one line of JSON.
 */
function plainBuildText(message: string): string {
  return message.replace(/[─-╿←-⇿]+/g, " ").replace(/\/home\/user\/app\//g, "");
}

/**
 * The error inside the page Vite answers with when a file will not compile.
 *
 * Asked for a module it cannot build, the dev server sends back not the error
 * but a small HTML page that shows it: the error itself is a JSON object in a
 * script on that page (`const error = {…}`). Quoted as it comes, the agent
 * would be handed markup and have to find the sentence in it. Null for
 * anything that is not such a page.
 */
export function viteErrorPage(html: string): { message: string; frame?: string } | null {
  const at = html.indexOf("const error = ");
  if (at === -1) return null;
  const start = html.indexOf("{", at);
  if (start === -1) return null;
  // The object ends where its braces balance, not at the first `}`: the
  // message and the frame are source code and full of them.
  let depth = 0;
  let inString = false;
  let end = -1;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      end = i;
      break;
    }
  }
  if (end === -1) return null;
  try {
    const parsed = JSON.parse(html.slice(start, end + 1)) as { message?: unknown; frame?: unknown };
    if (typeof parsed.message !== "string" || !parsed.message.trim()) return null;
    return {
      message: parsed.message,
      ...(typeof parsed.frame === "string" && parsed.frame.trim() ? { frame: parsed.frame } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Vite's own error, from wherever it showed up: the overlay in the page, or
 * the body of a script or document it answered 500 for.
 */
export function buildErrorOf(raw: RawInspection): RawOverlay | null {
  const overlay = raw.dom?.overlay;
  if (overlay?.message) {
    return {
      message: clip(plainBuildText(shortenIn(overlay.message, raw.origin)), MAX_BUILD_ERROR_CHARS),
      ...(overlay.file ? { file: overlayFile(overlay.file) } : {}),
      ...(overlay.frame ? { frame: overlay.frame.slice(0, MAX_BUILD_ERROR_CHARS) } : {}),
    };
  }
  const failedModule = raw.requests.find(
    (r) =>
      r.status === 500 &&
      (r.type === "Script" || r.type === "Document" || r.type === "Stylesheet") &&
      sameOrigin(r.url, raw.origin),
  );
  if (failedModule) {
    const file = shortUrl(failedModule.url, raw.origin);
    return {
      message: failedModule.body
        ? clip(plainBuildText(shortenIn(failedModule.body, raw.origin)), MAX_BUILD_ERROR_CHARS)
        : `The dev server could not compile ${file} (it answered 500).`,
      file,
      ...(failedModule.frame ? { frame: failedModule.frame.slice(0, MAX_BUILD_ERROR_CHARS) } : {}),
    };
  }
  if (raw.httpStatus === 500) {
    return { message: "The dev server answered 500 for the page itself." };
  }
  return null;
}

export function classify(raw: RawInspection): PreviewStatus {
  if (raw.navigationError) return "unreachable";
  if (raw.httpStatus === undefined) return "unreachable";
  if (buildErrorOf(raw)) return "build_error";
  // A gateway error, or a port with nothing behind it: the app was not reached.
  if (raw.httpStatus >= 400) return "unreachable";
  if (!raw.dom) return "unreachable";
  if (raw.dom.rootEmpty) {
    // A page still loading when time ran out is not known to be blank.
    if (raw.timedOut && raw.exceptions.length === 0) return "unreachable";
    return raw.exceptions.length > 0 ? "crashed" : "blank";
  }
  const ownFailures = failedRequests(raw.requests).filter((r) => sameOrigin(r.url, raw.origin));
  return raw.exceptions.length > 0 || ownFailures.length > 0 ? "rendered_with_errors" : "rendered";
}

const SUMMARY: Record<PreviewStatus, string> = {
  rendered: "The page loaded and the app is on screen. Nothing went wrong while it loaded.",
  rendered_with_errors:
    "The app is on screen, but something went wrong while it loaded: see the errors and failed requests below.",
  blank: "The page loaded but the app put nothing on screen, and no error was thrown.",
  crashed: "The page loaded but nothing rendered: an error was thrown while the app started.",
  build_error: "The app does not compile, so nothing can render.",
  unreachable: "The page could not be loaded.",
};

const NEXT: Partial<Record<PreviewStatus, string>> = {
  rendered_with_errors:
    "Fix what is listed. A failed `/api` request has the server's own answer in `body`; an exception names the file it was thrown in.",
  blank:
    "Nothing threw, so look at what decides whether anything is drawn: the route for this path in `src/App.tsx`, a component that returns null, a condition that is never true, or a request the first screen waits on.",
  crashed:
    "Open the file the first exception names and fix the cause, then inspect again.",
  build_error:
    "Fix the file named in `buildError`, then inspect again. Do not look further until it compiles.",
  unreachable:
    "Check the dev server is up: `curl -s -o /dev/null -w \"%{http_code}\" http://localhost:5173/`. Do not restart it yourself.",
};

/**
 * What to do about a crash, by where the first error was thrown. The advice
 * used to be one sentence, "open the file the first exception names", which is
 * no help for an error that names no file of the app's and is wrong for one
 * the app did not cause.
 */
const NEXT_CRASHED_IN_TOOLING =
  "This error was thrown by the dev server's own code in the page (see `thrownIn`), not by the app: do not edit the app's files to fix it. The usual cause is that the Vite installed in the project is not the version the dev server is running. Compare `node_modules/vite/package.json` with the `VITE v…` line in `/home/user/.tau-vite.log`; if they differ, install the running version (`bun add -d vite@<that version>`), then run `touch vite.config.ts` so the dev server reloads itself, wait a few seconds and inspect again. Installing alone is not enough: the server goes on serving the script it already read.";
const NEXT_CRASHED_IN_LIBRARY =
  "No file of the app's is in the stack: the error surfaced inside a package (see `thrownIn`), usually because of what the app passed to it. Read the message for what was wrong with the value, find where the app uses that package, and fix it there. Do not edit files in `node_modules`.";

function nextFor(status: PreviewStatus, first: ReportException | undefined): string | undefined {
  if (status === "crashed" && first && !first.at) {
    if (first.devTooling) return NEXT_CRASHED_IN_TOOLING;
    if (first.thrownIn) return NEXT_CRASHED_IN_LIBRARY;
  }
  return NEXT[status];
}

function unreachableSummary(raw: RawInspection): string {
  if (raw.navigationError) return `The page could not be loaded: ${clip(raw.navigationError, 160)}.`;
  if (raw.httpStatus !== undefined && raw.httpStatus >= 400) {
    return `The page could not be loaded: the server answered ${raw.httpStatus}.`;
  }
  if (raw.timedOut) return "The page did not finish loading in time, so what it shows is not known.";
  return SUMMARY.unreachable;
}

/** The report a model reads. `verbose` keeps `console.log` and `info` lines. */
export function buildReport(raw: RawInspection, opts: { verbose?: boolean } = {}): PreviewReport {
  const status = classify(raw);
  const exceptions = reportExceptions(raw.exceptions, raw.origin);
  const logged = reportConsole(raw.console, raw.origin, opts.verbose ?? false);
  const failed = reportRequests(raw.requests, raw.origin);
  const buildError = status === "build_error" ? buildErrorOf(raw) : null;

  const omitted: Record<string, number> = {};
  if (exceptions.omitted > 0) omitted.exceptions = exceptions.omitted;
  if (logged.omitted > 0) omitted.console = logged.omitted;
  if (failed.omitted > 0) omitted.failedRequests = failed.omitted;

  const title = raw.dom?.title?.trim();
  const showRendered = raw.dom && !raw.dom.rootEmpty;
  const next = nextFor(status, exceptions.list[0]);
  return fitReport({
    path: raw.path,
    status,
    summary: status === "unreachable" ? unreachableSummary(raw) : SUMMARY[status],
    ...(next ? { next } : {}),
    document: {
      ...(raw.httpStatus !== undefined ? { httpStatus: raw.httpStatus } : {}),
      ...(title ? { title: clip(title, 80) } : {}),
    },
    ...(showRendered
      ? {
          rendered: {
            visibleText: clip(raw.dom!.visibleText, MAX_VISIBLE_TEXT_CHARS),
            headings: raw.dom!.headings.slice(0, 6).map((h) => clip(h, 80)),
          },
        }
      : {}),
    ...(buildError ? { buildError } : {}),
    ...(exceptions.list.length > 0 ? { exceptions: exceptions.list } : {}),
    ...(logged.list.length > 0 ? { console: logged.list } : {}),
    ...(failed.list.length > 0 || status !== "rendered"
      ? { network: { requests: raw.requests.length, failed: failed.list } }
      : {}),
    ...(raw.stepsFailed.length > 0 ? { stepsFailed: raw.stepsFailed } : {}),
    ...(Object.keys(omitted).length > 0 ? { omitted } : {}),
    ...(exceptions.list.some((e) => e.at)
      ? {
          note: "Positions are in the file as the dev server compiled it; the line can be a few off from the source.",
        }
      : {}),
  });
}

/** The most a report may come to, as JSON. About 1,700 tokens. */
export const MAX_REPORT_CHARS = 7_000;

/**
 * Cut a report that is still too long, least useful parts first.
 *
 * The caps above bound each list, not their sum: an app that throws five
 * different errors, logs fifteen and fails ten requests with long answers
 * would still come to twice what a result should cost. Each step here gives up
 * something a reader can do without before anything they cannot: warnings
 * before errors, the tail of a stack before its head, the length of a
 * server's answer before the fact that it failed.
 */
export function fitReport(report: PreviewReport, maxChars = MAX_REPORT_CHARS): PreviewReport {
  const size = (r: PreviewReport) => JSON.stringify(r).length;
  if (size(report) <= maxChars) return report;

  let out: PreviewReport = { ...report };
  const omitted: Record<string, number> = { ...(report.omitted ?? {}) };
  const dropTo = <T,>(key: string, list: T[] | undefined, keep: number): T[] | undefined => {
    if (!list || list.length <= keep) return list;
    omitted[key] = (omitted[key] ?? 0) + (list.length - keep);
    return list.slice(0, keep);
  };
  const steps: Array<() => void> = [
    () => {
      const errorsOnly = out.console?.filter((c) => c.level === "error");
      if (out.console && errorsOnly) omitted.console = (omitted.console ?? 0) + (out.console.length - errorsOnly.length);
      out.console = dropTo("console", errorsOnly, 8);
    },
    () => {
      if (!out.network) return;
      out.network = {
        ...out.network,
        failed: out.network.failed.map((r) => (r.body ? { ...r, body: clip(r.body, 160) } : r)),
      };
    },
    () => {
      out.exceptions = out.exceptions?.map((e) => (e.stack ? { ...e, stack: e.stack.slice(0, 3) } : e));
    },
    () => {
      out.console = dropTo("console", out.console, 4)?.map((c) => ({ ...c, text: clip(c.text, 160) }));
    },
    () => {
      if (out.network) out.network = { ...out.network, failed: dropTo("failedRequests", out.network.failed, 5)! };
    },
    () => {
      out.exceptions = dropTo("exceptions", out.exceptions, 3)?.map((e) => ({ ...e, message: clip(e.message, 200) }));
    },
  ];
  for (const step of steps) {
    step();
    if (out.console && out.console.length === 0) delete out.console;
    out = { ...out, ...(Object.keys(omitted).length > 0 ? { omitted: { ...omitted } } : {}) };
    if (size(out) <= maxChars) break;
  }
  return out;
}

// ── In words, for the end-of-run check ───────────────────────────────────────

/**
 * What a broken report found, as a few lines of markdown. For the message a
 * run is sent back with (`finishGate.ts`): the same facts as the JSON, without
 * the parts that only matter when the app is working.
 */
export function describeFindings(report: PreviewReport): string {
  const lines: string[] = [];
  if (report.buildError) {
    lines.push(
      `- Build error${report.buildError.file ? ` in \`${report.buildError.file}\`` : ""}: ${report.buildError.message}`,
    );
    if (report.buildError.frame) lines.push(`\`\`\`\n${report.buildError.frame}\n\`\`\``);
  }
  for (const ex of report.exceptions ?? []) {
    const where = ex.at
      ? ` at \`${ex.at}\``
      : ex.thrownIn
        ? ` in \`${ex.thrownIn}\`${ex.devTooling ? " (the dev server's own code, not the app's)" : " (a package, not the app's own code)"}`
        : "";
    lines.push(`- Error thrown${where}: ${ex.message}`);
    if (ex.stack && ex.stack.length > 1) lines.push(`  Stack: ${ex.stack.slice(0, 5).join(" ← ")}`);
  }
  // A run sent back with "fix the app" over an error the app did not cause
  // would go looking in the app. Say where to look instead.
  const first = report.exceptions?.[0];
  if (first && !first.at && first.devTooling) lines.push(`- ${NEXT_CRASHED_IN_TOOLING}`);
  for (const r of report.network?.failed ?? []) {
    lines.push(
      `- Request failed: ${r.method} ${r.url} → ${r.status ?? r.error ?? "no response"}${r.body ? ` — ${r.body}` : ""}`,
    );
  }
  for (const c of (report.console ?? []).filter((c) => c.level === "error").slice(0, 4)) {
    lines.push(`- Console error: ${c.text}`);
  }
  if (lines.length === 0) lines.push("- Nothing was thrown, logged as an error, or failed to load.");
  return lines.join("\n");
}
