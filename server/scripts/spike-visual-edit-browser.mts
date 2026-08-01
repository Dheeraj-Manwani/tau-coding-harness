/**
 * Phase 0 spike, browser half — the cross-origin question.
 *
 * Runs under **Node, not Bun**: Playwright's bundled `ws` transport can't
 * complete the CDP handshake under Bun (see worker-service/src/lib/screenshot.ts,
 * which spawns Chromium and speaks CDP by hand to work around exactly this).
 * The sandbox half of the spike is Bun; it shells out to this.
 *
 * `.mts`, not `.ts`, and not `.mjs`: the root package.json has no
 * `"type": "module"`, so `.ts` here would be treated as CommonJS and the ESM
 * imports plus top-level await below would fail. `.mts` forces ESM and Node 24
 * strips the types natively — no build step, and it stays TypeScript like the
 * rest of the repo.
 *
 *   node scripts/spike-visual-edit-browser.mts <previewUrl> [expectedLoc]
 *
 * Needs a browser once: `npx playwright install chromium-headless-shell`.
 *
 * It serves a harness page on 127.0.0.1 that embeds the preview in an iframe
 * with the *same* sandbox attribute PreviewPane.tsx uses, then checks that:
 *   1. the runtime announces itself across the origin boundary,
 *   2. the parent can drive it (enable selection mode),
 *   3. a real click inside the iframe reports the right source location back.
 *
 * Exit code 0 = all checks passed.
 */
import { createServer } from "node:http";
import { chromium } from "playwright";

/** Shape the runtime posts back; mirrored from visual-edit/runtime.js. */
interface TauEvent {
  source: string;
  type: string;
  loc?: string;
  tagName?: string;
  text?: string;
  editableText?: boolean;
  siblingCount?: number;
  tagged?: number;
}

/**
 * Helpers the harness page hangs on `window` for Playwright to drive.
 *
 * These must be referenced as bare `window.__seen(...)` inside `page.evaluate`
 * callbacks. Those callbacks are serialised to source and re-evaluated **in the
 * browser**, so they close over nothing from this file — a local alias for
 * `window` here compiles fine and then throws `ReferenceError` in the page.
 */
declare global {
  interface Window {
    __events: TauEvent[];
    __seen: (type: string) => TauEvent[];
    __send: (msg: { type: string; loc?: string }) => void;
  }
}

const [previewUrl, expectedLoc] = process.argv.slice(2);
if (!previewUrl) {
  console.error(
    "usage: node spike-visual-edit-browser.mts <previewUrl> [expectedLoc]",
  );
  process.exit(2);
}

const PORT = 5599;
const HARNESS_ORIGIN = `http://127.0.0.1:${PORT}`;
const sandboxOrigin = new URL(previewUrl).origin;

// The iframe's sandbox attribute is copied verbatim from
// web/src/features/project/PreviewPane.tsx:150 — if visual edit works here but
// not in the app, that attribute is the first place to look.
const SANDBOX_ATTR =
  "allow-scripts allow-same-origin allow-forms allow-popups allow-modals";

const harness = `<!doctype html>
<meta charset="utf-8">
<title>tau visual-edit spike harness</title>
<style>html,body{margin:0;height:100%}iframe{width:100%;height:100%;border:0}</style>
<iframe id="f" src="${previewUrl}" sandbox="${SANDBOX_ATTR}"></iframe>
<script>
  window.__events = [];
  const SANDBOX_ORIGIN = ${JSON.stringify(sandboxOrigin)};

  window.addEventListener("message", (e) => {
    // The parent-side half of the origin check. Without this, any page could
    // post a fake selection carrying an arbitrary file path.
    if (e.origin !== SANDBOX_ORIGIN) return;
    const d = e.data;
    if (!d || d.source !== "tau-visual-edit") return;
    window.__events.push(d);
  });

  window.__send = (msg) => {
    document.getElementById("f").contentWindow.postMessage(
      Object.assign({ source: "tau-parent" }, msg),
      SANDBOX_ORIGIN,
    );
  };
  window.__seen = (type) => window.__events.filter((e) => e.type === type);
</script>`;

const server = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(harness);
});
await new Promise<void>((r) => server.listen(PORT, "127.0.0.1", () => r()));

const results: { label: string; ok: boolean; detail: string }[] = [];
function check(label: string, ok: boolean, detail = ""): void {
  results.push({ label, ok, detail });
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`,
  );
}

// Needs the headless shell: `npx playwright install chromium-headless-shell`.
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  await page.goto(HARNESS_ORIGIN, { waitUntil: "domcontentloaded" });

  // 1. Did the app itself load across the boundary?
  const frame = page.frameLocator("#f");
  await frame.locator("[data-tau-loc]").first().waitFor({ timeout: 30_000 });
  check("the preview renders inside the iframe", true);

  // 2. Are the tags actually in the live DOM (not just in the served module)?
  const taggedCount = await frame.locator("[data-tau-loc]").count();
  check(
    "elements carry data-tau-loc in the rendered DOM",
    taggedCount > 0,
    `${taggedCount} tagged`,
  );

  // 3. THE CROSS-ORIGIN QUESTION, inbound.
  await page.waitForFunction(() => window.__seen("tau:ready").length > 0, null, {
    timeout: 20_000,
  });
  check("runtime → parent postMessage crosses the origin boundary", true);

  // 4. THE CROSS-ORIGIN QUESTION, outbound: can the parent drive the runtime?
  await page.evaluate(() => window.__send({ type: "tau:ping" }));
  await page.waitForFunction(() => window.__seen("tau:pong").length > 0, null, {
    timeout: 10_000,
  });
  const pong = await page.evaluate(() => window.__seen("tau:pong")[0]);
  check(
    "parent → runtime postMessage is accepted",
    true,
    `runtime sees ${pong.tagged} tagged elements`,
  );

  // 5. Selection mode + a real click on a real element.
  await page.evaluate(() => window.__send({ type: "tau:enable" }));
  await page.waitForFunction(() => window.__seen("tau:mode").length > 0, null, {
    timeout: 10_000,
  });

  await frame.locator("#target").click({ timeout: 10_000 });
  await page.waitForFunction(() => window.__seen("tau:select").length > 0, null, {
    timeout: 10_000,
  });
  const sel = await page.evaluate(() => window.__seen("tau:select")[0]);

  check("clicking an element reports a selection", Boolean(sel.loc), sel.loc);
  check(
    "the reported element is the one clicked",
    sel.tagName === "button",
    sel.tagName,
  );

  if (expectedLoc) {
    check(
      "the reported source location is exact",
      sel.loc === expectedLoc,
      sel.loc === expectedLoc ? sel.loc : `got ${sel.loc}, want ${expectedLoc}`,
    );
  }

  check(
    "static text is correctly flagged as safely editable",
    sel.editableText === true,
    `text=${JSON.stringify(sel.text)}`,
  );

  // 6. The .map() case: three cards share one source line, so the runtime must
  //    report a sibling count that lets the UI warn "this changes all 3".
  await frame.locator(".spike-card").first().click({ timeout: 10_000 });
  await page.waitForFunction(() => window.__seen("tau:select").length > 1, null, {
    timeout: 10_000,
  });
  const cardSel = await page.evaluate(() => {
    const all = window.__seen("tau:select");
    return all[all.length - 1];
  });
  check(
    "elements from a .map() are detected as shared",
    cardSel.siblingCount === 3,
    `siblingCount=${cardSel.siblingCount}`,
  );

  // 7. The app's own click handler must not fire while selecting.
  const appClicks = (await frame.locator("#click-count").textContent()) ?? "";
  check(
    "selection does not trigger the app's own click handlers",
    appClicks.trim() === "0",
    `handler fired ${appClicks.trim()} times`,
  );
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(
  `\n  browser checks: ${results.length - failed.length}/${results.length} passed`,
);
process.exit(failed.length === 0 ? 0 : 1);
