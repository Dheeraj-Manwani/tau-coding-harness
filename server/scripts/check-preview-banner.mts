/** Run with Node (Playwright's browser transport does not work under Bun). */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chromium } from "playwright";
import { PREVIEW_CAPTURE_INIT_SCRIPT, previewBannerScript } from "../src/lib/previewBanner/index.ts";

const script = previewBannerScript("https://app.tauai.pro/", "test-project");
assert.ok(!script.includes("</script"), "Inline script must not terminate its HTML tag");
const errors: string[] = [];
const server = createServer((req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  if (req.url === "/embedded") {
    res.end('<iframe src="/preview" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>');
    return;
  }
  res.end(`<html><head><style>body{margin:0;padding-top:7px}main{min-height:200vh}</style></head><body style="padding-top:9px!important"><main><h1>Preview app</h1></main>${req.url === "/production" ? "" : `<script>${script}</script>`}</body></html>`);
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch();
try {
  const context = await browser.newContext();
  // Allow inspection of the isolated banner's closed shadow root in this harness.
  await context.addInitScript(() => {
    const original = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (options) {
      return original.call(this, { ...options, mode: "open" });
    };
  });
  const page = await context.newPage();
  page.on("pageerror", (err) => errors.push(err.message));
  await page.goto(`${origin}/preview`);
  const banner = page.locator("tau-preview-banner");
  await banner.waitFor();
  assert.equal(await banner.locator("a").getAttribute("href"), "https://app.tauai.pro/project/test-project?publish=1");
  const reserved = await page.evaluate(() => ({
    padding: parseFloat(getComputedStyle(document.body).paddingTop),
    height: document.querySelector("tau-preview-banner")!.getBoundingClientRect().height,
  }));
  assert.equal(reserved.padding, reserved.height + 9);
  await page.evaluate(() => window.scrollTo(0, 500));
  assert.equal((await banner.boundingBox())!.y, 0, "Banner stays visible while scrolling");
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForFunction(() => {
    const host = document.querySelector("tau-preview-banner")!;
    return parseFloat(getComputedStyle(document.body).paddingTop) === host.getBoundingClientRect().height + 9;
  });
  assert.ok((await banner.boundingBox())!.height > reserved.height, "Mobile copy wraps and reserves more space");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 375, "No mobile horizontal overflow");
  await banner.getByRole("button", { name: "Dismiss development preview notice" }).click();
  assert.equal(await banner.count(), 0);
  assert.equal(await page.evaluate(() => document.body.style.getPropertyValue("padding-top")), "9px");
  assert.equal(await page.evaluate(() => document.body.style.getPropertyPriority("padding-top")), "important");
  await page.reload();
  assert.equal(await banner.count(), 0, "Dismissal persists after refresh");
  await page.goto(`${origin}/another-route`);
  assert.equal(await banner.count(), 0, "Dismissal persists after navigation");
  const newTab = await context.newPage();
  await newTab.goto(`${origin}/preview`);
  assert.equal(await newTab.locator("tau-preview-banner").count(), 1, "A fresh tab shows the banner");
  // Use the same CDP initialization as production cover capture. The banner
  // must never mount or reserve space, including after a page reload.
  const capturePage = await context.newPage();
  const captureSession = await context.newCDPSession(capturePage);
  await captureSession.send("Page.enable");
  await captureSession.send("Page.addScriptToEvaluateOnNewDocument", {
    source: PREVIEW_CAPTURE_INIT_SCRIPT,
  });
  for (const reload of [false, true]) {
    if (reload) await capturePage.reload();
    else await capturePage.goto(`${origin}/preview`);
    assert.equal(await capturePage.locator("tau-preview-banner").count(), 0, "Cover captures exclude the banner");
    assert.equal(await capturePage.evaluate(() => getComputedStyle(document.body).paddingTop), "9px", "Cover captures keep the app's original spacing");
    assert.ok((await capturePage.screenshot({ type: "jpeg" })).length > 0);
  }
  assert.equal(await newTab.locator("tau-preview-banner").count(), 1, "Capture suppression is isolated from normal preview tabs");
  await capturePage.close();
  await newTab.goto(`${origin}/embedded`);
  const embedded = newTab.frameLocator("iframe");
  await embedded.locator("h1").waitFor();
  assert.equal(await embedded.locator("tau-preview-banner").count(), 0, "Embedded previews hide it");
  await newTab.goto(`${origin}/production`);
  assert.equal(await newTab.locator("tau-preview-banner").count(), 0);
  const blockedStorage = await context.newPage();
  await blockedStorage.addInitScript(() => {
    Object.defineProperty(window, "sessionStorage", { get() { throw new Error("Storage blocked"); } });
  });
  await blockedStorage.goto(`${origin}/preview`);
  await blockedStorage.locator("tau-preview-banner").getByRole("button").click();
  assert.equal(await blockedStorage.locator("tau-preview-banner").count(), 0);
  assert.deepEqual(errors, []);
  await page.goto(`${origin}/preview?new-session=1`);
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => window.scrollTo(0, 0));
  if (process.argv[2]) await page.screenshot({ path: process.argv[2], fullPage: false });
  await context.close();
  console.log("Preview banner browser checks passed: standalone, embedded, cover capture without reserved spacing, dismissal, mobile, publish link, blocked storage.");
} finally {
  await browser.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
