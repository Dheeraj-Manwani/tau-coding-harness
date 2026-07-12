import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { env } from "./env";

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
const SETTLE_MS = 1_200; // let hydration / entrance animation land
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

/**
 * Navigate to `url` and return a card-sized JPEG of the first fold.
 *
 * Waits for `Page.loadEventFired` (bounded) + a fixed settle rather than network
 * idle: generated apps often hold a WebSocket or poll, so we shoot whatever
 * rendered — a faithful thumbnail either way.
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
    await new Promise((r) => setTimeout(r, SETTLE_MS));

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
    return Buffer.from(data, "base64");
  } finally {
    page?.close();
    // Keep the browser warm; only close this page target.
    await browser
      .send("Target.closeTarget", { targetId })
      .catch(() => undefined);
  }
}
