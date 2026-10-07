import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { env } from "@/lib/env";
import { PREVIEW_CAPTURE_INIT_SCRIPT } from "@/lib/previewBanner";
import {
  screenshotLooksUseful,
  type ScreenshotPixelStats,
} from "./screenshotQuality";

/**
 * Headless-browser screenshots of a finished app's live preview URL.
 *
 * We drive Chromium over the DevTools Protocol (CDP) using Bun's *native*
 * WebSocket rather than Playwright's `launch()`/`connectOverCDP()`. Playwright's
 * bundled `ws` transport hangs under Bun (it can't complete the CDP WebSocket
 * handshake), whereas Bun's native WebSocket connects fine — so we spawn the
 * Playwright-managed Chromium ourselves and speak CDP directly. Playwright is
 * kept only to install + locate the browser binary (`executablePath()`).
 *
 * The browser process is launched lazily and kept warm across jobs; each
 * capture opens its own page target (worker concurrency is >1). The page lays
 * out at 1280 CSS px and the screenshot's `clip.scale: 0.5` emits a 640x400
 * JPEG directly — no server-side resize (and no native image dep) needed.
 */

const VIEWPORT = { width: 1280, height: 800 };
const DEVICE_SCALE = 0.5; // clip scale → 640x400 output
// Completion can arrive before Vite's final HMR paint, especially for a fresh
// sandbox that is still warming dependencies. Covers are non-interactive and
// captured once per completed run, so waiting generously is preferable to
// permanently storing a fast but empty frame.
const INITIAL_SETTLE_MS = 10_000;
const RETRY_SETTLE_MS = 2_500;
const MAX_CAPTURE_ATTEMPTS = 8;
const JPEG_QUALITY = 72;
const LAUNCH_TIMEOUT_MS = 30_000;

// ── Minimal CDP JSON-RPC over one WebSocket ──────────────────────────────────

class CdpConnection {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private readonly eventWaiters = new Map<string, Array<() => void>>();

  private constructor(private readonly ws: WebSocket) {
    ws.onmessage = (e) => this.onMessage(e.data as string);
    ws.onclose = () => {
      for (const p of this.pending.values())
        p.reject(new Error("CDP connection closed"));
      this.pending.clear();
    };
  }

  static connect(url: string): Promise<CdpConnection> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const timer = setTimeout(
        () => reject(new Error(`CDP connect timeout: ${url}`)),
        LAUNCH_TIMEOUT_MS,
      );
      ws.onopen = () => {
        clearTimeout(timer);
        resolve(new CdpConnection(ws));
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error(`CDP connect failed: ${url}`));
      };
    });
  }

  private onMessage(raw: string): void {
    let msg: {
      id?: number;
      result?: unknown;
      error?: { message?: string };
      method?: string;
    };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof msg.id === "number") {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message ?? "CDP error"));
      else p.resolve(msg.result);
    } else if (msg.method) {
      const waiters = this.eventWaiters.get(msg.method);
      if (waiters) {
        this.eventWaiters.delete(msg.method);
        for (const w of waiters) w();
      }
    }
  }

  send<T = Record<string, unknown>>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      this.ws.send(JSON.stringify({ id, method, params: params ?? {} }));
    });
  }

  /** Resolve the next time `method` is received (or on timeout). */
  waitForEvent(method: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      const list = this.eventWaiters.get(method) ?? [];
      list.push(() => {
        clearTimeout(timer);
        resolve();
      });
      this.eventWaiters.set(method, list);
    });
  }

  get connected(): boolean {
    return this.ws.readyState === WebSocket.OPEN;
  }

  close(): void {
    try {
      this.ws.close();
    } catch {
      // already closing
    }
  }
}

// ── Warm browser session ─────────────────────────────────────────────────────

type Session = { conn: CdpConnection; proc: ChildProcess; wsBase: string };
let sessionPromise: Promise<Session> | null = null;

async function launchSession(): Promise<Session> {
  const userDataDir = await mkdtemp(join(tmpdir(), "tau-shot-"));
  const proc = spawn(
    chromium.executablePath(),
    [
      "--headless=new",
      "--remote-debugging-port=0", // 0 → OS picks a free port, printed on stderr
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${userDataDir}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );

  const browserWs = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("chromium did not report a DevTools endpoint")),
      LAUNCH_TIMEOUT_MS,
    );
    let buf = "";
    proc.stderr?.on("data", (chunk: Buffer) => {
      buf += chunk.toString();
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]!);
      }
    });
    proc.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`chromium exited before ready (code ${code})`));
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

  // ws://127.0.0.1:<port>/devtools/browser/<id> → base "ws://127.0.0.1:<port>"
  const wsBase = new URL(browserWs).origin;
  const conn = await CdpConnection.connect(browserWs);
  return { conn, proc, wsBase };
}

async function getSession(): Promise<Session> {
  if (!sessionPromise) {
    sessionPromise = launchSession().catch((err) => {
      sessionPromise = null;
      throw err;
    });
  }
  const session = await sessionPromise;
  if (!session.conn.connected) {
    session.proc.kill();
    sessionPromise = null;
    return getSession();
  }
  return session;
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Measure a downsampled capture inside Chromium, where JPEG decoding is free. */
async function pixelStats(
  page: CdpConnection,
  jpegBase64: string,
): Promise<ScreenshotPixelStats> {
  const expression = `new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 40;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return reject(new Error("2d canvas unavailable"));
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let sum = 0;
      let sumSquares = 0;
      let min = 255;
      let max = 0;
      const buckets = new Set();
      const count = pixels.length / 4;
      for (let i = 0; i < pixels.length; i += 4) {
        const luma = 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
        sum += luma;
        sumSquares += luma * luma;
        min = Math.min(min, luma);
        max = Math.max(max, luma);
        buckets.add(Math.round(luma / 16));
      }
      const mean = sum / count;
      resolve({
        mean,
        variance: sumSquares / count - mean * mean,
        range: max - min,
        buckets: buckets.size,
      });
    };
    image.onerror = () => reject(new Error("screenshot decode failed"));
    image.src = "data:image/jpeg;base64,${jpegBase64}";
  })`;

  const evaluated = await page.send<{
    result: { value?: ScreenshotPixelStats };
    exceptionDetails?: unknown;
  }>("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  const stats = evaluated.result.value;
  if (!stats) throw new Error("could not inspect screenshot pixels");
  return stats;
}

async function captureJpeg(page: CdpConnection): Promise<string> {
  const { data } = await page.send<{ data: string }>(
    "Page.captureScreenshot",
    {
      format: "jpeg",
      quality: JPEG_QUALITY,
      clip: {
        x: 0,
        y: 0,
        width: VIEWPORT.width,
        height: VIEWPORT.height,
        scale: DEVICE_SCALE,
      },
    },
  );
  return data;
}

/**
 * Navigate to `url` and return a card-sized JPEG of the first fold.
 *
 * Waits for `Page.loadEventFired` (bounded), then rejects and retries visually
 * empty frames. Generated apps often keep a WebSocket open, so network-idle is
 * not useful; pixel variance tells us whether the first fold has actually
 * painted without knowing anything about the generated app's DOM.
 */
export async function captureAppScreenshot(url: string): Promise<Buffer> {
  const { conn: browser, wsBase } = await getSession();

  const { targetId } = await browser.send<{ targetId: string }>(
    "Target.createTarget",
    { url: "about:blank" },
  );

  let page: CdpConnection | null = null;
  try {
    page = await CdpConnection.connect(`${wsBase}/devtools/page/${targetId}`);
    await page.send("Page.enable");
    await page.send("Runtime.enable");
    // Prevent the development notice and its body spacing before either mounts.
    // The script also applies after redirects/reloads within this capture target.
    await page.send("Page.addScriptToEvaluateOnNewDocument", {
      source: PREVIEW_CAPTURE_INIT_SCRIPT,
    });
    await page.send("Emulation.setDeviceMetricsOverride", {
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      deviceScaleFactor: 1,
      mobile: false,
    });

    const loaded = page.waitForEvent(
      "Page.loadEventFired",
      env.SCREENSHOT_TIMEOUT_MS,
    );
    await page.send("Page.navigate", { url });
    await loaded;
    await new Promise((r) => setTimeout(r, INITIAL_SETTLE_MS));

    let lastStats: ScreenshotPixelStats | null = null;
    for (let attempt = 1; attempt <= MAX_CAPTURE_ATTEMPTS; attempt++) {
      const data = await captureJpeg(page);
      lastStats = await pixelStats(page, data);
      if (screenshotLooksUseful(lastStats)) {
        return Buffer.from(data, "base64");
      }
      if (attempt < MAX_CAPTURE_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, RETRY_SETTLE_MS));
      }
    }

    throw new Error(
      `preview remained visually blank after ${MAX_CAPTURE_ATTEMPTS} captures` +
        (lastStats
          ? ` (variance=${lastStats.variance.toFixed(1)}, range=${lastStats.range.toFixed(1)}, buckets=${lastStats.buckets})`
          : ""),
    );
  } finally {
    page?.close();
    // Keep the browser warm; only close this page target.
    await browser
      .send("Target.closeTarget", { targetId })
      .catch(() => undefined);
  }
}

// ── Whole-page views, for design review ──────────────────────────────────────

/** How to look at a page: the window to lay it out in, and how much of it to keep. */
export interface PageView {
  /** Layout width in CSS pixels: 1280 for a desktop, 390 for a phone. */
  width: number;
  /** Window height in CSS pixels — what "the first screen" means for this view. */
  height: number;
  /** Lay out as a touch device (affects `hover`/`pointer` media queries and the viewport meta tag). */
  mobile: boolean;
  /** The most of the page's height, in CSS pixels, that one picture shows. */
  maxHeight: number;
  /** Output pixels per CSS pixel. */
  scale: number;
}

/** One picture of a stretch of a page: from `from` to `to` pixels down it. */
export interface PageSection {
  jpeg: Buffer;
  from: number;
  to: number;
}

export interface PageCapture {
  /** The page from the top down, a picture per section. A short page has one. */
  sections: PageSection[];
  /** The page's full height in CSS pixels. */
  pageHeight: number;
  /** How much of that the pictures show. Less than `pageHeight` when the page outran them. */
  capturedHeight: number;
  /**
   * How far the page itself is wider than the window, in CSS pixels; 0 when it
   * fits. Anything more means the whole page scrolls sideways.
   */
  overflowX: number;
  /**
   * The opening words of each area inside the page that scrolls sideways — a
   * wide table, a row of filters. A still picture cannot show that such an
   * area scrolls, only that its content stops at the edge.
   */
  sideScrollers: string[];
}

const REVIEW_SETTLE_MS = 2_500;
const REVIEW_CAPTURE_ATTEMPTS = 4;
const REVIEW_JPEG_QUALITY = 70;

/**
 * Where to cut a page of `pageHeight` into at most `maxSections` pictures of
 * at most `maxHeight` each. The pictures are equal, so a page a little over
 * one picture tall becomes two halves rather than one full picture and a
 * sliver. Whatever lies beyond the last picture is not shown.
 */
export function sectionBounds(
  pageHeight: number,
  maxHeight: number,
  maxSections: number,
): { from: number; to: number }[] {
  const covered = Math.min(pageHeight, maxHeight * Math.max(1, maxSections));
  const count = Math.max(1, Math.ceil(covered / maxHeight));
  const each = Math.ceil(covered / count);
  return Array.from({ length: count }, (_, i) => ({
    from: i * each,
    to: Math.min(covered, (i + 1) * each),
  }));
}

/**
 * Capture a page from the top down, as someone scrolling it would see it.
 *
 * Differs from {@link captureAppScreenshot} in three ways, all because the
 * image is for judging a design rather than decorating a card:
 *
 *   - it keeps going below the first screen: up to `maxSections` pictures of
 *     up to `view.maxHeight` each, one under the other. A long page is cut
 *     into pictures rather than shrunk into one, because a picture several
 *     times taller than it is wide is scaled down until its text cannot be
 *     read;
 *   - it scrolls the page to the bottom and back first. Sections that reveal
 *     themselves as they scroll into view start out invisible, and a capture
 *     taken without scrolling shows them as blank bands — which a reviewer
 *     would report as the app being broken;
 *   - it asks for reduced motion, so nothing is caught half-way through an
 *     entrance animation.
 */
export async function capturePageView(
  url: string,
  view: PageView,
  maxSections = 1,
): Promise<PageCapture> {
  const { conn: browser, wsBase } = await getSession();
  const { targetId } = await browser.send<{ targetId: string }>(
    "Target.createTarget",
    { url: "about:blank" },
  );

  let page: CdpConnection | null = null;
  try {
    page = await CdpConnection.connect(`${wsBase}/devtools/page/${targetId}`);
    await page.send("Page.enable");
    await page.send("Runtime.enable");
    await page.send("Page.addScriptToEvaluateOnNewDocument", {
      source: PREVIEW_CAPTURE_INIT_SCRIPT,
    });
    await page.send("Emulation.setDeviceMetricsOverride", {
      width: view.width,
      height: view.height,
      deviceScaleFactor: 1,
      mobile: view.mobile,
    });
    await page.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });

    // A page asked for moments after its files were written can still be
    // compiling, and paints nothing. Reload and look again a few times before
    // deciding it really is blank.
    let lastStats: ScreenshotPixelStats | null = null;
    for (let attempt = 1; attempt <= REVIEW_CAPTURE_ATTEMPTS; attempt++) {
      const loaded = page.waitForEvent(
        "Page.loadEventFired",
        env.SCREENSHOT_TIMEOUT_MS,
      );
      await page.send(attempt === 1 ? "Page.navigate" : "Page.reload", attempt === 1 ? { url } : {});
      await loaded;
      await new Promise((r) => setTimeout(r, REVIEW_SETTLE_MS));

      // Walk down the page a screen at a time so anything waiting to be seen
      // is seen, then return to the top. Reports the page's full height.
      // Also measures what a picture cannot show: whether the page, or an
      // area inside it, scrolls sideways.
      const walked = await page.send<{
        result: { value?: { height?: number; overflowX?: number; sideScrollers?: string[] } };
      }>(
        "Runtime.evaluate",
        {
          expression: `(async () => {
            const height = () => Math.max(
              document.documentElement.scrollHeight,
              document.body ? document.body.scrollHeight : 0,
            );
            const limit = ${Math.round(view.maxHeight * maxSections)};
            const step = Math.max(200, Math.floor(window.innerHeight * 0.8));
            for (let y = 0; y < Math.min(height(), limit); y += step) {
              window.scrollTo(0, y);
              await new Promise((r) => setTimeout(r, 120));
            }
            window.scrollTo(0, 0);
            await new Promise((r) => setTimeout(r, 250));
            const sideScrollers = [];
            for (const el of document.querySelectorAll("body *")) {
              if (sideScrollers.length >= 4) break;
              if (el.clientWidth === 0 || el.scrollWidth <= el.clientWidth + 8) continue;
              const overflowX = getComputedStyle(el).overflowX;
              if (overflowX !== "auto" && overflowX !== "scroll") continue;
              const words = (el.innerText || "").trim().replace(/\\s+/g, " ").slice(0, 48);
              if (words) sideScrollers.push(words);
            }
            return {
              height: height(),
              overflowX: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
              sideScrollers,
            };
          })()`,
          awaitPromise: true,
          returnByValue: true,
        },
      );
      const measured = walked.result.value ?? {};
      const pageHeight = Math.max(view.height, Math.round(measured.height ?? view.height));
      const bounds = sectionBounds(pageHeight, view.maxHeight, maxSections);
      const shoot = async ({ from, to }: { from: number; to: number }) =>
        (
          await page!.send<{ data: string }>("Page.captureScreenshot", {
            format: "jpeg",
            quality: REVIEW_JPEG_QUALITY,
            captureBeyondViewport: true,
            clip: { x: 0, y: from, width: view.width, height: to - from, scale: view.scale },
          })
        ).data;

      // The top of the page says whether anything rendered at all.
      const first = await shoot(bounds[0]!);
      lastStats = await pixelStats(page, first);
      if (screenshotLooksUseful(lastStats)) {
        const sections: PageSection[] = [{ jpeg: Buffer.from(first, "base64"), ...bounds[0]! }];
        for (const bound of bounds.slice(1)) {
          sections.push({ jpeg: Buffer.from(await shoot(bound), "base64"), ...bound });
        }
        return {
          sections,
          pageHeight,
          capturedHeight: bounds[bounds.length - 1]!.to,
          overflowX: Math.round(measured.overflowX ?? 0),
          sideScrollers: measured.sideScrollers ?? [],
        };
      }
    }
    throw new Error(
      `the page rendered blank after ${REVIEW_CAPTURE_ATTEMPTS} attempts` +
        (lastStats ? ` (variance=${lastStats.variance.toFixed(1)}, range=${lastStats.range.toFixed(1)})` : ""),
    );
  } finally {
    page?.close();
    await browser
      .send("Target.closeTarget", { targetId })
      .catch(() => undefined);
  }
}
