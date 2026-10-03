/**
 * Renders the sitewide 1200×630 Open Graph / Twitter card image.
 *
 * `useDocumentMeta` (`src/components/useDocumentMeta.ts`) falls back to this
 * file — `public/og-image.png` — for every page that doesn't set its own
 * `image`. Without it `og:image`/`twitter:image` had no file to point at, so
 * a tau link pasted into WhatsApp, iMessage or Slack unfurled as a bare title
 * with no card at all.
 *
 * A screenshot rather than a hand-exported PNG so the card is built from the
 * same τ path (`src/components/ui/tau-glyph.ts`) and palette
 * (`src/index.css`) as the app itself: redraw the glyph once, regenerate the
 * card, no asset to keep in sync by hand. Playwright is already a dependency
 * here (see `prerender.ts`), so this adds nothing to install.
 *
 *   bun run scripts/generate-og-image.ts
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { TAU_PATH_D, TAU_VIEWBOX } from "../src/components/ui/tau-glyph.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_FILES = [
  resolve(HERE, "..", "public", "og-image.png"),
  resolve(HERE, "..", "..", "web", "public", "og-image.png"),
];

const WIDTH = 1200;
const HEIGHT = 630;

// Mirrors `src/index.css`'s space/silver/blue tokens: this HTML never loads
// the app's stylesheet, so the handful of values this card needs are copied
// in literally rather than imported.
const CARD_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; }
  body {
    position: relative;
    background: #09090b;
    font-family: "Inter", "Helvetica Neue", Arial, sans-serif;
  }
  .glow {
    position: absolute;
    top: -260px;
    left: -220px;
    width: 900px;
    height: 900px;
    background: radial-gradient(circle, rgba(96,165,250,0.22) 0%, rgba(96,165,250,0) 70%);
  }
  .grid {
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(rgba(250,250,250,0.035) 1px, transparent 1px),
      linear-gradient(90deg, rgba(250,250,250,0.035) 1px, transparent 1px);
    background-size: 48px 48px;
    mask-image: radial-gradient(ellipse at 30% 35%, black 0%, transparent 72%);
  }
  .content {
    position: relative;
    display: flex;
    align-items: center;
    height: 100%;
    padding: 0 96px;
    gap: 56px;
  }
  .glyph {
    width: 220px;
    height: 225px;
    flex-shrink: 0;
  }
  .glyph path {
    fill: none;
    stroke: #fafafa;
    stroke-width: 34;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .text h1 {
    font-size: 104px;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: #fafafa;
    line-height: 1;
  }
  .text p {
    margin-top: 22px;
    font-size: 36px;
    font-weight: 500;
    color: #a1a1aa;
    letter-spacing: -0.01em;
  }
  .url {
    position: absolute;
    bottom: 48px;
    right: 96px;
    font-size: 26px;
    font-weight: 600;
    color: #60a5fa;
    letter-spacing: 0.01em;
  }
</style>
</head>
<body>
  <div class="glow"></div>
  <div class="grid"></div>
  <div class="content">
    <svg class="glyph" viewBox="0 0 ${TAU_VIEWBOX.width} ${TAU_VIEWBOX.height}">
      <path d="${TAU_PATH_D}" />
    </svg>
    <div class="text">
      <h1>tau</h1>
      <p>describe it. build it.</p>
    </div>
  </div>
  <div class="url">tauai.pro</div>
</body>
</html>`;

/** Mirrors `prerender.ts`'s resolver: playwright lives in `worker-service`, not here. */
async function loadChromium(): Promise<typeof import("playwright")["chromium"]> {
  const anchors = [
    import.meta.url,
    new URL("../../worker-service/package.json", import.meta.url).href,
  ];

  for (const anchor of anchors) {
    try {
      const resolved = createRequire(anchor).resolve("playwright");
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
    "[og-image] playwright is not installed. Run `pnpm install` in the repo root,\n" +
      "           then `npx playwright install chromium`.",
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const chromium = await loadChromium();
  const browser = await chromium.launch();
  try {
    // Exactly 1200×630 (the OG/Twitter spec size): no retina multiplier, so
    // crawlers that cap card file size or re-encode it aren't handed a 4×
    // pixel count for a card made of vector shapes and type.
    const page = await browser.newPage({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: 1,
    });
    await page.setContent(CARD_HTML, { waitUntil: "load" });
    const png = await page.screenshot({ type: "png" });

    for (const file of OUT_FILES) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, png);
      const kb = (Buffer.byteLength(readFileSync(file)) / 1024).toFixed(0);
      console.error(`[og-image] wrote ${file} (${kb}KB)`);
    }
  } finally {
    await browser.close();
  }
}

await main();
