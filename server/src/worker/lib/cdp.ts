import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

/**
 * tau's headless browser, and the connection to it.
 *
 * We drive Chromium over the DevTools Protocol (CDP) using Bun's *native*
 * WebSocket rather than Playwright's `launch()`/`connectOverCDP()`. Playwright's
 * bundled `ws` transport hangs under Bun (it can't complete the CDP WebSocket
 * handshake), whereas Bun's native WebSocket connects fine — so we spawn the
 * Playwright-managed Chromium ourselves and speak CDP directly. Playwright is
 * kept only to install + locate the browser binary (`executablePath()`).
 *
 * The browser process is launched lazily and kept warm across jobs; every
 * caller opens its own page target (worker concurrency is >1). Two things use
 * it: pictures of an app (`screenshot.ts`) and reading what an app logs and
 * requests as it loads (`previewInspect.ts`).
 */

const LAUNCH_TIMEOUT_MS = 30_000;

/** What a CDP event carries. */
export type CdpParams = Record<string, unknown>;

// ── Minimal CDP JSON-RPC over one WebSocket ──────────────────────────────────

export class CdpConnection {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private readonly eventWaiters = new Map<string, Array<() => void>>();
  private readonly listeners = new Map<string, Set<(params: CdpParams) => void>>();

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
      params?: CdpParams;
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
      const listeners = this.listeners.get(msg.method);
      if (listeners) {
        for (const listener of listeners) {
          // One listener's fault must not stop the others, or the socket.
          try {
            listener(msg.params ?? {});
          } catch {
            // ignored
          }
        }
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

  /**
   * Call `listener` every time `method` is received, until the connection
   * closes or the returned function is called. `waitForEvent` hears an event
   * once; this is for watching a page for as long as it is open.
   */
  on(method: string, listener: (params: CdpParams) => void): () => void {
    const set = this.listeners.get(method) ?? new Set();
    set.add(listener);
    this.listeners.set(method, set);
    return () => {
      set.delete(listener);
    };
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

export type BrowserSession = { conn: CdpConnection; proc: ChildProcess; wsBase: string };
let sessionPromise: Promise<BrowserSession> | null = null;

async function launchSession(): Promise<BrowserSession> {
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

/** The shared browser, started on first use and restarted if it has gone away. */
export async function getBrowserSession(): Promise<BrowserSession> {
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
    return getBrowserSession();
  }
  return session;
}

/** Where the browser binary is expected to be. Does not start it. */
export function browserExecutablePath(): string {
  return chromium.executablePath();
}
