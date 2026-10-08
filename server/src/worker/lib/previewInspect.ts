import { existsSync } from "node:fs";
import { env } from "@/lib/env";
import { Gate } from "@/lib/kimi";
import { PREVIEW_CAPTURE_INIT_SCRIPT } from "@/lib/previewBanner";
import { CdpConnection, browserExecutablePath, getBrowserSession, type CdpParams } from "./cdp";
import {
  MAX_BODY_CHARS,
  buildReport,
  formatConsoleArgs,
  type PreviewReport,
  type RawConsole,
  type RawDom,
  type RawException,
  type RawInspection,
  type RawRequest,
} from "./previewReport";
import { describeAction, performActionScript, type PageAction } from "./screenshot";

/**
 * Open a route of a running app in tau's headless browser and read what a
 * person with the developer tools open would see: the console, uncaught
 * errors, every request and how it ended, and whether anything was drawn.
 *
 * This is the only way tau learns that an app is broken in the browser. A
 * single-page app answers 200 to `curl` whatever state it is in, because the
 * page is a shell and what appears in it is decided later by JavaScript.
 *
 * Collecting is here; judging and trimming are in `previewReport.ts`, which
 * needs no browser and is where the tests are.
 *
 * See doc/PREVIEW_DIAGNOSTICS_PLAN.md §3.1.
 */

const VIEWPORTS = {
  desktop: { width: 1280, height: 800, mobile: false },
  mobile: { width: 390, height: 844, mobile: true },
} as const;
export type InspectViewport = keyof typeof VIEWPORTS;

export interface InspectOptions {
  /** Route to open. Defaults to `/`. */
  path?: string;
  /** Things to do once the page has loaded, before it is read. */
  steps?: readonly PageAction[];
  viewport?: InspectViewport;
  /** Keep `console.log` and `info` lines, not only errors and warnings. */
  verbose?: boolean;
  /** The whole inspection must be done within this. */
  deadlineMs?: number;
  /** How long to wait for the app to draw something before calling it blank. */
  renderWaitMs?: number;
}

const DEFAULT_DEADLINE_MS = 30_000;
const DEFAULT_RENDER_WAIT_MS = 8_000;
/** After the app has drawn, how long nothing new must happen before reading it. */
const QUIET_MS = 700;
/** After an error with nothing drawn: time for an error screen to appear. */
const AFTER_ERROR_MS = 1_200;
/** How long an empty page must have fetched and received nothing to count as done loading. */
const SETTLED_MS = 1_500;
/** Kept back from the deadline for reading the page and closing it. */
const WIND_DOWN_MS = 3_000;
const POLL_MS = 250;
const STEP_SETTLE_MS = 800;
/** Responses read for their body, at most. */
const MAX_BODIES = 6;

/**
 * Addresses a page under inspection may not reach: this machine and the
 * private network around it. The app is somebody else's code running in a
 * browser on tau's server, and nothing it does should be able to talk to what
 * only tau's server can see. Matched on the URL, so it is a fence, not a wall.
 */
const PRIVATE_URL_PATTERNS = [
  "*://localhost*",
  "*://127.*",
  "*://0.0.0.0*",
  "*://10.*",
  "*://192.168.*",
  "*://169.254.*",
  "*://[::1]*",
  ...Array.from({ length: 16 }, (_, i) => `*://172.${16 + i}.*`),
];

function globMatches(pattern: string, url: string): boolean {
  const source = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}$`).test(url);
}

/**
 * The fence, minus any part of it the app itself stands on. A preview is never
 * on a private address in production; one is when tau is developed or tested
 * against a server on this machine, and blocking it would block the page.
 */
export function blockedUrlPatterns(origin: string): string[] {
  const own = `${new URL(origin).origin}/`;
  return PRIVATE_URL_PATTERNS.filter((pattern) => !globMatches(pattern, own));
}

let browserFound: boolean | null = null;

/**
 * Whether this deployment can inspect a preview at all. `SCREENSHOT_ENABLED`
 * is the deployment's word on whether it has a browser — design review goes by
 * it too — and `PREVIEW_INSPECT_ENABLED` turns only this off.
 */
export function previewInspectAvailable(): boolean {
  if (!env.PREVIEW_INSPECT_ENABLED || !env.SCREENSHOT_ENABLED) return false;
  if (browserFound === null) {
    try {
      browserFound = existsSync(browserExecutablePath());
    } catch {
      browserFound = false;
    }
  }
  return browserFound;
}

/** Pages being inspected at once, across every run in this process. */
const gate = new Gate(2);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The route as a path on the preview: `pricing` and `/pricing` are the same. */
export function normalizePath(path: unknown): string {
  if (typeof path !== "string" || !path.trim()) return "/";
  const trimmed = path.trim();
  // A full URL is not a route. Take its path, never its host.
  const pathOnly = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? (() => {
        try {
          const u = new URL(trimmed);
          return `${u.pathname}${u.search}`;
        } catch {
          return "/";
        }
      })()
    : trimmed;
  return pathOnly.startsWith("/") ? pathOnly : `/${pathOnly}`;
}

function levelOf(type: unknown): RawConsole["level"] {
  if (type === "error" || type === "assert") return "error";
  if (type === "warning") return "warning";
  if (type === "info") return "info";
  if (type === "debug" || type === "verbose") return "debug";
  return "log";
}

interface RemoteObject {
  type?: string;
  value?: unknown;
  description?: string;
  unserializableValue?: string;
}

function argText(arg: RemoteObject): string {
  if (arg.type === "string") return String(arg.value ?? "");
  if (arg.value !== undefined && typeof arg.value !== "object") return String(arg.value);
  if (arg.description) return arg.description;
  if (arg.unserializableValue) return arg.unserializableValue;
  if (arg.value !== undefined) {
    try {
      return JSON.stringify(arg.value);
    } catch {
      return "[object]";
    }
  }
  return arg.type ?? "";
}

interface CallFrame {
  functionName?: string;
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
}

function framesOf(stack: unknown): RawException["frames"] {
  const frames = (stack as { callFrames?: CallFrame[] } | undefined)?.callFrames ?? [];
  return frames.map((f) => ({
    fn: f.functionName ?? "",
    url: f.url ?? "",
    line: (f.lineNumber ?? 0) + 1,
    col: (f.columnNumber ?? 0) + 1,
  }));
}

/** What the page looks like right now. Runs in the page. */
const READ_DOM = `(() => {
  const text = (root, sel) => {
    const el = root.querySelector(sel);
    return el ? (el.textContent || "").trim() : "";
  };
  const overlayEl = document.querySelector("vite-error-overlay");
  let overlay = null;
  if (overlayEl && overlayEl.shadowRoot) {
    const r = overlayEl.shadowRoot;
    const message = text(r, ".message-body") || text(r, ".message");
    if (message) overlay = { message, file: text(r, ".file"), frame: text(r, ".frame") };
  }
  // "Drawn" means something a person could see, not something in the DOM: an
  // app that renders nothing still leaves the toast container and the theme
  // switch behind, and a root with only those in it is a blank page.
  const root = document.querySelector("#root, #app") || document.body;
  const seen = (el) => {
    if (el.closest("[data-tau-overlay], [data-tau-theme-toggle], tau-badge, vite-error-overlay")) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0;
  };
  const words = root ? (root.innerText || "").replace(/\\s+/g, " ").trim() : "";
  const drawn =
    words.length > 0 ||
    (root
      ? [...root.querySelectorAll("img, svg, canvas, video, iframe, input, textarea, select, button")].some(seen)
      : false);
  const rootEmpty = !drawn;
  return {
    title: document.title || "",
    rootEmpty,
    visibleText: words.slice(0, 600),
    headings: [...document.querySelectorAll("h1, h2, h3")]
      .map((h) => (h.textContent || "").replace(/\\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 8),
    overlay,
    hasOverlay: Boolean(overlayEl),
  };
})()`;

type DomRead = RawDom & { hasOverlay: boolean };

/**
 * Inspect one route of the app at `origin`. Never throws: a page that cannot
 * be opened, or an inspection that runs out of time, is a report saying so.
 */
export async function inspectPreview(
  origin: string,
  options: InspectOptions = {},
): Promise<PreviewReport> {
  const path = normalizePath(options.path);
  const raw: RawInspection = {
    origin: new URL(origin).origin,
    path,
    exceptions: [],
    console: [],
    requests: [],
    dom: null,
    stepsFailed: [],
  };
  const deadlineMs = options.deadlineMs ?? DEFAULT_DEADLINE_MS;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), deadlineMs);
  });
  // Set once a page is open, so that whether or not the work finished it can be
  // closed, and what it had collected by then can be read.
  const hooks: PageHooks = { close: null, sync: null };

  try {
    const outcome = await Promise.race([
      gate.run(() => collect(raw, options, hooks)).then(() => "done" as const),
      timeout,
    ]);
    if (outcome === "timeout") {
      raw.timedOut = true;
      hooks.sync?.();
    }
  } catch (err) {
    // The browser itself failed: launch, connect, a protocol error.
    raw.navigationError ??= `tau's browser could not open the page (${err instanceof Error ? err.message : String(err)})`;
  } finally {
    clearTimeout(timer);
    await hooks.close?.().catch(() => undefined);
  }
  return buildReport(raw, { verbose: options.verbose });
}

/** The app's own scripts and stylesheets that the dev server answered 500 for. */
function refusedModules<T extends RawRequest>(requests: Iterable<T>, origin: string): T[] {
  return [...requests].filter((r) => {
    if (r.status !== 500 || r.method !== "GET") return false;
    if (r.type !== "Script" && r.type !== "Stylesheet") return false;
    try {
      return new URL(r.url).origin === origin;
    } catch {
      return false;
    }
  });
}

interface PageHooks {
  close: (() => Promise<void>) | null;
  /** Copy what the listeners have gathered so far into the raw inspection. */
  sync: (() => void) | null;
}

async function collect(raw: RawInspection, options: InspectOptions, hooks: PageHooks): Promise<void> {
  const { conn: browser, wsBase } = await getBrowserSession();
  const { targetId } = await browser.send<{ targetId: string }>("Target.createTarget", {
    url: "about:blank",
  });
  const page = await CdpConnection.connect(`${wsBase}/devtools/page/${targetId}`);
  hooks.close = async () => {
    page.close();
    await browser.send("Target.closeTarget", { targetId }).catch(() => undefined);
  };

  const view = VIEWPORTS[options.viewport ?? "desktop"];
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  await page.send("Log.enable");
  await page.send("Network.enable");
  await page.send("Network.setBlockedURLs", { urls: blockedUrlPatterns(raw.origin) }).catch(() => undefined);
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: PREVIEW_CAPTURE_INIT_SCRIPT });
  await page.send("Emulation.setDeviceMetricsOverride", {
    width: view.width,
    height: view.height,
    deviceScaleFactor: 1,
    mobile: view.mobile,
  });

  // ── Listen ────────────────────────────────────────────────────────────────
  // Requests by the browser's id for them, in the order they started.
  const requests = new Map<string, RawRequest & { loaderId?: string; done?: boolean }>();
  const wantsBody = new Set<string>();
  const bodies: Promise<void>[] = [];
  let documentRequestId: string | null = null;
  const collectStarted = Date.now();
  let lastActivity = Date.now();
  let lastNavigationAt = Date.now();
  let mainFrameNavigations = 0;
  const touch = () => {
    lastActivity = Date.now();
  };

  page.on("Runtime.exceptionThrown", (p) => {
    touch();
    const d = (p.exceptionDetails ?? {}) as {
      text?: string;
      exception?: RemoteObject;
      stackTrace?: unknown;
      url?: string;
      lineNumber?: number;
      columnNumber?: number;
    };
    const described = d.exception?.description ?? "";
    // "TypeError: x is not a function\n    at App (…)" — the first line is the message.
    const message = (described.split("\n")[0] || argText(d.exception ?? {}) || d.text || "Uncaught error").trim();
    const frames = framesOf(d.stackTrace);
    if (frames.length === 0 && d.url) {
      frames.push({ fn: "", url: d.url, line: (d.lineNumber ?? 0) + 1, col: (d.columnNumber ?? 0) + 1 });
    }
    raw.exceptions.push({ message, frames });
  });

  page.on("Runtime.consoleAPICalled", (p) => {
    touch();
    const args = (p.args ?? []) as RemoteObject[];
    const top = framesOf(p.stackTrace)[0];
    raw.console.push({
      level: levelOf(p.type),
      text: formatConsoleArgs(args.map(argText)),
      ...(top ? { url: top.url, line: top.line } : {}),
    });
  });

  page.on("Log.entryAdded", (p) => {
    const entry = (p.entry ?? {}) as { source?: string; level?: string; text?: string; url?: string; lineNumber?: number };
    // A failed request is in the network list already, with more detail.
    if (entry.source === "network") return;
    raw.console.push({
      level: levelOf(entry.level),
      text: entry.text ?? "",
      ...(entry.url ? { url: entry.url, line: (entry.lineNumber ?? 0) + 1 } : {}),
    });
  });

  page.on("Network.requestWillBeSent", (p) => {
    touch();
    const request = (p.request ?? {}) as { url?: string; method?: string };
    const id = String(p.requestId);
    const url = request.url ?? "";
    if (url.startsWith("data:") || url.startsWith("blob:")) return;
    const type = String(p.type ?? "Other");
    requests.set(id, { method: request.method ?? "GET", url, type, loaderId: String(p.loaderId ?? "") });
    if (type === "Document" && p.frameId !== undefined && !documentRequestId) documentRequestId = id;
  });

  page.on("Network.responseReceived", (p) => {
    touch();
    const id = String(p.requestId);
    const entry = requests.get(id);
    if (!entry) return;
    const response = (p.response ?? {}) as { status?: number };
    entry.status = response.status;
    if (p.type) entry.type = String(p.type);
    const readable = ["XHR", "Fetch", "Script", "Document", "Stylesheet"].includes(entry.type);
    let own = false;
    try {
      own = new URL(entry.url).origin === raw.origin;
    } catch {
      own = false;
    }
    if (own && readable && (entry.status ?? 0) >= 400 && wantsBody.size < MAX_BODIES) wantsBody.add(id);
  });

  page.on("Network.loadingFinished", (p) => {
    touch();
    const id = String(p.requestId);
    const finished = requests.get(id);
    if (finished) finished.done = true;
    if (!wantsBody.has(id)) return;
    bodies.push(
      page
        .send<{ body?: string; base64Encoded?: boolean }>("Network.getResponseBody", { requestId: id })
        .then((res) => {
          const entry = requests.get(id);
          if (!entry || !res.body) return;
          const text = res.base64Encoded ? Buffer.from(res.body, "base64").toString("utf8") : res.body;
          entry.body = text.slice(0, MAX_BODY_CHARS * 4);
        })
        .catch(() => undefined),
    );
  });

  page.on("Network.loadingFailed", (p) => {
    touch();
    const entry = requests.get(String(p.requestId));
    if (!entry) return;
    entry.done = true;
    entry.errorText = String(p.blockedReason ? `blocked (${String(p.blockedReason)})` : (p.errorText ?? "failed"));
  });

  // The dev server reloads the page by itself when it finishes preparing a
  // dependency. What the first load logged then describes a page that is gone.
  page.on("Page.frameNavigated", (p: CdpParams) => {
    const frame = (p.frame ?? {}) as { parentId?: string; loaderId?: string; url?: string };
    if (frame.parentId || frame.url === "about:blank") return;
    if (mainFrameNavigations++ === 0) return;
    raw.exceptions.length = 0;
    raw.console.length = 0;
    for (const [id, entry] of requests) {
      if (entry.loaderId !== frame.loaderId) requests.delete(id);
    }
    documentRequestId = [...requests.entries()].find(([, r]) => r.type === "Document")?.[0] ?? null;
    lastNavigationAt = Date.now();
    touch();
  });

  const sync = () => {
    raw.requests = [...requests.values()].map(({ loaderId: _loaderId, done: _done, ...r }) => r);
    const doc = documentRequestId ? requests.get(documentRequestId) : undefined;
    raw.httpStatus = doc?.status;
    if (doc?.errorText && doc.status === undefined) raw.navigationError ??= doc.errorText;
  };
  hooks.sync = sync;

  // ── Load ──────────────────────────────────────────────────────────────────
  const renderWaitMs = options.renderWaitMs ?? DEFAULT_RENDER_WAIT_MS;
  const loaded = page.waitForEvent("Page.loadEventFired", Math.min(env.SCREENSHOT_TIMEOUT_MS, 15_000));
  const navigation = await page.send<{ errorText?: string }>("Page.navigate", {
    url: `${raw.origin}${raw.path}`,
  });
  if (navigation.errorText) {
    raw.navigationError = navigation.errorText;
    sync();
    return;
  }
  await loaded;
  sync();

  const readDom = async (): Promise<DomRead | null> => {
    const res = await page
      .send<{ result: { value?: DomRead } }>("Runtime.evaluate", { expression: READ_DOM, returnByValue: true })
      .catch(() => null);
    return res?.result.value ?? null;
  };

  // Wait for the app to draw, to fail, or to be plainly doing neither.
  //
  // "Blank" is the verdict that is easy to get wrong. The first time anyone
  // opens an app the dev server is still compiling it and preparing its
  // dependencies, and then reloads the page by itself: for ten seconds or more
  // there is an empty root and no error, exactly as there is for an app that
  // draws nothing. So an empty page is only called blank once it has also
  // gone quiet — nothing being fetched, nothing arriving, no reload since. One
  // still busy when the time is nearly up is reported as not having finished
  // loading, which nobody acts on, rather than as blank, which sends a run
  // back to fix an app that works. (That happened, on the first real run.)
  const started = Date.now();
  const lookUntil = collectStarted + (options.deadlineMs ?? DEFAULT_DEADLINE_MS) - WIND_DOWN_MS;
  const inFlight = () =>
    [...requests.values()].filter((r) => !r.done && r.type !== "EventSource" && r.type !== "WebSocket").length;
  const settled = () => inFlight() === 0 && Date.now() - lastActivity >= SETTLED_MS;
  let dom = await readDom();
  let errorSeenAt: number | null = null;
  let refusedAt: number | null = null;
  for (;;) {
    // A reload starts the wait again: it is a new page.
    const waited = Date.now() - Math.max(started, lastNavigationAt);
    if (dom?.hasOverlay) break;
    // The dev server refused one of the app's own files: it will not render.
    // A moment more, because the overlay that explains it arrives separately.
    if (refusedModules(requests.values(), raw.origin).length > 0) {
      refusedAt ??= Date.now();
      if (Date.now() - refusedAt >= AFTER_ERROR_MS) break;
    } else if (dom && !dom.rootEmpty) {
      if (Date.now() - lastActivity >= QUIET_MS || waited >= renderWaitMs) break;
    } else if (raw.exceptions.length > 0) {
      errorSeenAt ??= Date.now();
      if (Date.now() - errorSeenAt >= AFTER_ERROR_MS) break;
    } else if (waited >= renderWaitMs && settled()) {
      break;
    }
    if (Date.now() >= lookUntil) {
      raw.timedOut = true;
      break;
    }
    await sleep(POLL_MS);
    dom = await readDom();
  }

  // ── Act ───────────────────────────────────────────────────────────────────
  for (const step of options.steps ?? []) {
    const done = await page
      .send<{ result: { value?: boolean } }>("Runtime.evaluate", {
        expression: performActionScript(step),
        awaitPromise: true,
        returnByValue: true,
      })
      .catch(() => null);
    if (done?.result.value !== true) raw.stepsFailed.push(describeAction(step));
    await sleep(STEP_SETTLE_MS);
  }
  if ((options.steps ?? []).length > 0) dom = await readDom();

  // The overlay is drawn a frame after its element is added.
  if (dom?.hasOverlay && !dom.overlay) {
    await sleep(POLL_MS);
    dom = (await readDom()) ?? dom;
  }

  await Promise.race([Promise.allSettled(bodies), sleep(2_000)]);
  // A module the dev server answered 500 for never finishes loading in the
  // browser, so its body cannot be read there. The body is the compile error;
  // ask the dev server for it again from here. Only ever a GET of the app's
  // own file, which the page had already asked for.
  if (!dom?.overlay) {
    await Promise.all(
      refusedModules(requests.values(), raw.origin)
        .filter((r) => !r.body)
        .slice(0, 2)
        .map(async (r) => {
          try {
            const res = await fetch(r.url, { signal: AbortSignal.timeout(3_000), cache: "no-store" });
            if (res.status === 500) r.body = (await res.text()).slice(0, MAX_BODY_CHARS * 4);
          } catch {
            // The status alone still says which file.
          }
        }),
    );
  }
  sync();
  if (dom) {
    const { hasOverlay: _hasOverlay, ...rest } = dom;
    raw.dom = rest;
  }
}
