/**
 * Prerenders the public routes to static HTML (§7, open decision #5).
 *
 * `web/` is a client-only Vite SPA, so the landing page and all 41 doc pages
 * ship as an empty `<div id="root">` plus a script tag. A crawler that does not
 * run JS sees nothing — no headings, no prose, no `<title>`, no canonical. The
 * docs are, to that crawler, one blank page.
 *
 * This walks the built `dist/` with a real browser and writes what it rendered
 * back over each route's `index.html`, so the first bytes contain the content and
 * the meta tags `useDocumentMeta` produced. The SPA then hydrates over the top
 * and behaves exactly as before.
 *
 * Chosen over a Vite prerender plugin or a framework migration because it is one
 * file with no build-graph involvement, and it covers every route from the same
 * manifest the sitemap uses. Playwright is already a dependency of
 * `worker-service` (project screenshots), so this adds nothing to install.
 *
 *   bun run scripts/prerender.ts             # after `vite build`
 *   SITE_ORIGIN=https://staging.example.com bun run scripts/prerender.ts
 *
 * Exit codes: 0 all routes written, 1 one or more failed.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { Browser } from "playwright";

import { STATIC_ROUTES, siteOrigin } from "./public-routes.ts";

/**
 * Resolve playwright at run time rather than importing it at the top.
 *
 * It is declared in this package, but it is also a `worker-service` dependency
 * (project screenshots) and installs here are per-package — so a checkout that
 * has only installed `worker-service/` would otherwise fail with a bare
 * module-not-found and no hint about which install fixes it.
 *
 * `createRequire` rather than a relative `import()`: ESM will not resolve a
 * path to a package *directory*, so the fallback has to go through Node's
 * package resolution anchored at the other workspace.
 */
async function loadChromium(): Promise<typeof import("playwright")["chromium"]> {
  const anchors = [
    import.meta.url,
    new URL("../worker-service/package.json", import.meta.url).href,
  ];

  for (const anchor of anchors) {
    try {
      const resolved = createRequire(anchor).resolve("playwright");
      // Playwright is CommonJS. Under Node's ESM interop its exports land on
      // `.default`, while Bun surfaces them as named — hence both.
      const mod = (await import(pathToFileURL(resolved).href)) as {
        chromium?: typeof import("playwright")["chromium"];
        default?: { chromium?: typeof import("playwright")["chromium"] };
      };
      const chromium = mod.chromium ?? mod.default?.chromium;
      if (chromium) return chromium;
    } catch {
      // Try the next workspace.
    }
  }

  console.error(
    "[prerender] playwright is not installed. Run `pnpm install` in the repo root,\n" +
      "            then `npx playwright install chromium`.",
  );
  process.exit(1);
}

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(HERE, "..", "web", "dist");
const DOCS_INDEX = resolve(
  HERE,
  "..",
  "web",
  "src",
  "content",
  "docs-index.json",
);

/**
 * How long to wait for a route to settle.
 *
 * Deliberately **not** `waitUntil: "networkidle"`. A docs page fetches its
 * markdown chunk after first paint and then shiki fetches a grammar and the wasm
 * regex engine, so "no requests for 500ms" arrives late and unpredictably — it
 * timed out on a different five routes on each run. Playwright discourages it
 * for exactly this reason.
 *
 * Instead: navigate to `domcontentloaded`, then wait for a route-specific
 * selector that proves the content this page exists to serve is in the DOM.
 * That is a real signal rather than a proxy for one.
 */
const NAV_TIMEOUT_MS = 30_000;
const SETTLE_TIMEOUT_MS = 20_000;

/**
 * Extra grace for progressive enhancement after the content is in.
 *
 * Syntax highlighting upgrades a code block once shiki lands. Snapshotting a
 * moment later captures the highlighted markup, which is strictly nicer in the
 * static HTML — but it is a bonus, so this waits briefly and never fails on it.
 */
const POLISH_MS = 1_200;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".avif": "image/avif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

/**
 * Serve `dist/` with SPA fallback, so the router sees the real path.
 *
 * `vite preview` would also work, but spawning it means owning a child process,
 * parsing its port out of stdout and racing its readiness. This is twenty lines
 * and starts synchronously.
 *
 * The fallback is served from the `shell` passed in, **not** re-read from disk.
 * `/`'s output is written to `dist/index.html`, which is also the fallback — so
 * reading it per request would serve the already-prerendered landing page as the
 * starting document for every subsequent route, and React would hydrate over
 * another page's markup. That is what it did on the first version of this
 * script, and the symptom was `/pricing` timing out on its own `h1` while the
 * landing page's was sitting in the DOM.
 */
function serveDist(
  shell: Buffer,
): Promise<{ port: number; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]!);
    const candidate = join(DIST, urlPath);

    // A path with an extension is an asset: 404 it rather than falling back to
    // the shell, which would hand the browser HTML where it expected JS and
    // produce a mystery syntax error instead of a missing-file error.
    const ext = extname(urlPath);

    if (!ext) {
      res.writeHead(200, { "content-type": MIME[".html"]! });
      res.end(shell);
      return;
    }
    if (!existsSync(candidate)) {
      res.writeHead(404).end("not found");
      return;
    }

    res.writeHead(200, { "content-type": MIME[ext] ?? "application/octet-stream" });
    res.end(readFileSync(candidate));
  });

  return new Promise((resolveServer) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolveServer({
        port,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

/** Doc routes come from the generated index, so this cannot drift from the tree. */
function docRoutes(): string[] {
  if (!existsSync(DOCS_INDEX)) {
    console.error(
      "[prerender] docs-index.json is missing. Run scripts/build-docs-index.ts first.",
    );
    return [];
  }
  const index = JSON.parse(readFileSync(DOCS_INDEX, "utf8")) as {
    pages: { path: string }[];
  };
  return index.pages.map((page) => page.path);
}

/**
 * The selector that proves a route rendered its own content.
 *
 * Waiting on `#root` having children is not enough — the shell mounts before the
 * page's own chunk resolves, so that would snapshot a nav bar and a loader.
 */
function settleSelector(route: string): string {
  if (route.startsWith("/docs/") && route.split("/").length > 3) {
    // A doc page renders its markdown into `.docs-body` only once the body has
    // been fetched, which is exactly the thing worth indexing.
    return ".docs-body";
  }
  if (route === "/changelog") return "article time";
  return "main h1, h1";
}

/** Rendered HTML, keyed by route. Written to disk only once every route is in. */
type Rendered = Map<string, string>;

async function prerender(
  browser: Browser,
  origin: string,
  route: string,
  out: Rendered,
): Promise<boolean> {
  const page = await browser.newPage({
    // A desktop viewport: the landing page hides some bands below `sm`, and the
    // docs sidebar is a `<nav>` we want in the markup.
    viewport: { width: 1280, height: 900 },
  });

  try {
    await page.goto(`${origin}${route}`, {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT_MS,
    });
    await page.waitForSelector(settleSelector(route), {
      timeout: SETTLE_TIMEOUT_MS,
    });
    await page.waitForTimeout(POLISH_MS);

    const html = await page.content();

    // Rewrite the canonical and og:url from the local origin to the real one.
    // `useDocumentMeta` derives them from `window.location.origin`, which during
    // prerendering is 127.0.0.1 — shipping that would tell crawlers every page's
    // canonical URL is on localhost.
    out.set(route, html.replaceAll(origin, siteOrigin()));

    const kb = (Buffer.byteLength(out.get(route)!) / 1024).toFixed(0);
    console.error(`[prerender] ${route} → ${kb}KB`);
    return true;
  } catch (err) {
    console.error(
      `[prerender] FAILED ${route}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  } finally {
    await page.close();
  }
}

/** True when `dist/index.html` still has an empty `#root` — i.e. a fresh build. */
function isPristineShell(html: string): boolean {
  return /<div id="root">\s*<\/div>/.test(html);
}

async function main(): Promise<void> {
  const shellPath = join(DIST, "index.html");
  if (!existsSync(shellPath)) {
    console.error("[prerender] web/dist is missing. Run `vite build` first.");
    process.exit(1);
  }

  const shell = readFileSync(shellPath);
  // Running twice over the same `dist/` would render every route on top of the
  // previous run's landing-page markup. Refusing is better than producing
  // plausible-looking double-rendered HTML.
  if (!isPristineShell(shell.toString("utf8"))) {
    console.error(
      "[prerender] web/dist/index.html is already prerendered.\n" +
        "            Run `vite build` again before prerendering.",
    );
    process.exit(1);
  }

  const chromium = await loadChromium();
  const routes = [...STATIC_ROUTES.map((r) => r.path), ...docRoutes()];
  const server = await serveDist(shell);
  const origin = `http://127.0.0.1:${server.port}`;
  const browser = await chromium.launch();

  const rendered: Rendered = new Map();
  let failed = 0;
  try {
    // Serial on purpose. These are ~50 routes against one local server on a
    // build machine; parallelism buys a few seconds and costs the ability to
    // read which route broke from the log.
    for (const route of routes) {
      const ok = await prerender(browser, origin, route, rendered);
      if (!ok) failed += 1;
    }
  } finally {
    await browser.close();
    await server.close();
  }

  // Written after the browser is gone, so nothing being rendered can ever read a
  // route's output as its own starting document.
  for (const [route, html] of rendered) {
    const outDir = join(DIST, route === "/" ? "" : route);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "index.html"), html);
  }

  console.error(
    `[prerender] ${routes.length - failed}/${routes.length} routes written` +
      (failed ? ` — ${failed} failed` : ""),
  );
  // A silently half-prerendered site is worse than a failed build: the routes
  // that failed still ship, as empty shells, and nothing says so.
  if (failed > 0) process.exit(1);
}

await main();
