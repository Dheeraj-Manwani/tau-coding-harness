import { env } from "@/lib/env";
import { PREVIEW_CAPTURE_INIT_SCRIPT } from "@/lib/previewBanner";
import { CdpConnection, getBrowserSession } from "./cdp";
import {
  screenshotLooksUseful,
  type ScreenshotPixelStats,
} from "./screenshotQuality";

/**
 * Headless-browser screenshots of a finished app's live preview URL.
 *
 * The browser and the DevTools connection to it are in `cdp.ts`, shared with
 * the preview inspector. Each capture opens its own page target. The page lays
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
  const { conn: browser, wsBase } = await getBrowserSession();

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

/**
 * The script that does one action in the page. True when it found something to
 * act on. A match is by what the thing says — its text, its label, its
 * placeholder — exactly first, then as a part of what it says.
 */
export function performActionScript(action: PageAction): string {
  return `(async () => {
    const action = ${JSON.stringify(action)};
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
    };
    const norm = (s) => (s || "").replace(/\\s+/g, " ").trim().toLowerCase();
    const pick = (els, words) => {
      const want = norm(action.click ?? action.fill);
      const named = els.filter(visible).map((el) => [el, words(el).map(norm).filter(Boolean)]);
      return (
        named.find(([, w]) => w.includes(want)) ||
        named.find(([, w]) => w.some((x) => x.includes(want)))
      )?.[0];
    };
    if ("click" in action) {
      const el = pick(
        [...document.querySelectorAll('button, a, [role=button], [role=tab], [role=menuitem], [role=switch], summary, label, input[type=submit], input[type=checkbox], input[type=radio]')],
        (el) => [el.innerText || el.textContent, el.getAttribute("aria-label"), el.getAttribute("title"), el.value],
      );
      if (!el) return false;
      el.scrollIntoView({ block: "center" });
      el.click();
      return true;
    }
    const field = pick(
      [...document.querySelectorAll("input, textarea, select")],
      (el) => [
        el.getAttribute("aria-label"),
        el.getAttribute("placeholder"),
        el.getAttribute("name"),
        el.id && document.querySelector('label[for="' + el.id + '"]')?.textContent,
        el.closest("label")?.textContent,
      ],
    );
    if (!field) return false;
    field.scrollIntoView({ block: "center" });
    field.focus();
    const proto = field.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : field.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(field, action.with);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`;
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

/**
 * One thing a person does on a page before it is looked at: press something,
 * or type into a field. Found by what it says, not by selector, because the
 * builder naming a button knows its label and not its markup.
 */
export type PageAction = { click: string } | { fill: string; with: string };

/** An action in words, for a caption. */
export function describeAction(action: PageAction): string {
  return "click" in action ? `click "${action.click}"` : `type "${action.with}" into "${action.fill}"`;
}

export interface PageCapture {
  /** The page from the top down, a picture per section. A short page has one. */
  sections: PageSection[];
  /**
   * The whole page in one picture, shrunk to fit, when it is longer than the
   * sections cover. For judging how it is arranged and whether anything lower
   * down is missing or broken; the text in it cannot be read.
   */
  overview?: Buffer;
  /** Actions that could not be done, as words: nothing on the page had that label. */
  actionsFailed: string[];
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
const ACTION_SETTLE_MS = 800;
/** Chrome will not draw a picture much taller than this. */
const OVERVIEW_MAX_PAGE_PX = 12_000;
/** How tall the shrunken whole-page picture is, at most, in output pixels. */
const OVERVIEW_MAX_OUTPUT_PX = 1_600;
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
  actions: readonly PageAction[] = [],
): Promise<PageCapture> {
  const { conn: browser, wsBase } = await getBrowserSession();
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

      const actionsFailed: string[] = [];
      for (const action of actions) {
        const done = await page.send<{ result: { value?: boolean } }>("Runtime.evaluate", {
          expression: performActionScript(action),
          awaitPromise: true,
          returnByValue: true,
        });
        if (done.result.value !== true) actionsFailed.push(describeAction(action));
        await new Promise((r) => setTimeout(r, ACTION_SETTLE_MS));
      }

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
        const covered = bounds[bounds.length - 1]!.to;
        let overview: Buffer | undefined;
        if (pageHeight > covered) {
          const height = Math.min(pageHeight, OVERVIEW_MAX_PAGE_PX);
          const scale = Math.min(view.scale, OVERVIEW_MAX_OUTPUT_PX / height);
          const data = (
            await page.send<{ data: string }>("Page.captureScreenshot", {
              format: "jpeg",
              quality: REVIEW_JPEG_QUALITY,
              captureBeyondViewport: true,
              clip: { x: 0, y: 0, width: view.width, height, scale },
            })
          ).data;
          overview = Buffer.from(data, "base64");
        }
        return {
          sections,
          ...(overview ? { overview } : {}),
          actionsFailed,
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
