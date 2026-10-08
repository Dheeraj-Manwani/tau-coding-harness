/** Integration harness: actual cross-origin iframe, React hook and bootstrap monitor. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { previewHealthScript } from "../src/lib/previewBanner/index.ts";

const workspace = fileURLToPath(new URL("../../", import.meta.url));
const outputDir = mkdtempSync(join(tmpdir(), "tau-preview-recovery-"));
const bundlePath = join(outputDir, "harness.js");
execFileSync("bun", ["build", "test/fixtures/previewRecoveryHarness.tsx", "--outfile", bundlePath], { cwd: resolve(workspace, "web"), stdio: "pipe" });
const bundle = readFileSync(bundlePath);
// Filled in once the port is known: the monitor only hands its errors to the
// origin it is told is tau.
let health = previewHealthScript();
let foreignHealth = health;
const requests = new Map<string, number>();
const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const scenario = url.searchParams.get("scenario") ?? "transient";
  if (url.pathname === "/harness.js") {
    res.setHeader("Content-Type", "application/javascript"); res.end(bundle); return;
  }
  if (url.pathname === "/entry.js") {
    res.setHeader("Content-Type", "application/javascript");
    if ((scenario === "transient" && requests.get(scenario) === 1) || scenario === "build-error") {
      res.statusCode = 503; res.end("// Vite restarting"); return;
    }
    if (scenario === "exception" || scenario === "exception-foreign") { res.end('function start() { throw new Error("App bootstrap failed") }\nstart()'); return; }
    const delay = scenario === "delayed" ? 500 : 0;
    res.end(`setTimeout(()=>{document.getElementById('root').innerHTML='<h1>Running app</h1>'},${delay});`);
    return;
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  if (url.pathname === "/preview") {
    requests.set(scenario, (requests.get(scenario) ?? 0) + 1);
    if (scenario === "provider-error") {
      res.statusCode = 502;
      res.end("<html><body><h1>E2B sandbox not found</h1></body></html>");
      return;
    }
    if (scenario === "legacy-live") {
      res.end('<html><body><div id="root"><h1>Legacy running app</h1></div><script>window.parent.postMessage({source:"tau-visual-edit",type:"tau:ready"},"*");</script></body></html>');
      return;
    }
    const overlay = scenario === "build-error" ? '<script>setTimeout(()=>document.body.appendChild(document.createElement("vite-error-overlay")),100)</script>' : "";
    res.end(`<html><head><script>${scenario === "exception-foreign" ? foreignHealth : health}</script><script type="module" src="/entry.js?scenario=${scenario}"></script></head><body><div id="root"></div>${overlay}</body></html>`);
    return;
  }
  res.end('<html><body><div id="root"></div><script type="module" src="/harness.js"></script></body></html>');
});
await new Promise<void>((resolve) => server.listen(0, "0.0.0.0", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
const parent = `http://localhost:${address.port}`;
health = previewHealthScript(parent);
foreignHealth = previewHealthScript("https://not-tau.example");
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(`${parent}/?scenario=dead-recovery`);
  await page.getByRole("status").getByText("Restoring your preview…").waitFor();
  assert.equal(await page.locator("iframe").count(), 0, "Do not navigate to the dead URL during a chat");
  assert.equal(requests.get("provider-error") ?? 0, 0);
  await page.getByRole("button", { name: "Replacement ready", exact: true }).click();
  await page.waitForFunction(() => JSON.parse(document.querySelector("output")!.textContent!).phase === "loaded");
  assert.equal(await page.locator('[data-testid="surface"]').innerText(), "frame");
  assert.equal(await page.locator("iframe").isVisible(), true);
  assert.equal(requests.get("provider-error") ?? 0, 0, "Recovery never requested the known-dead URL");

  await page.goto(`${parent}/?scenario=dead-recovery`);
  await page.getByRole("button", { name: "Fail restoration", exact: true }).click();
  await page.getByRole("alert").waitFor();
  assert.equal(await page.locator("iframe").count(), 0);
  await page.goto(`${parent}/?scenario=dead-recovery`);
  await page.getByRole("button", { name: "Cancel chat", exact: true }).click();
  assert.equal(await page.locator('[data-testid="surface"]').innerText(), "stopped");
  assert.equal(await page.locator("iframe").count(), 0);

  await page.goto(`${parent}/?scenario=provider-error`);
  await page.frameLocator("iframe").getByText("E2B sandbox not found").waitFor({ state: "attached" });
  // Longer than the old 1.5-second blind reveal. Provider HTML remains hidden.
  await new Promise((resolve) => setTimeout(resolve, 1_800));
  assert.equal(await page.locator("iframe").isVisible(), false);
  assert.equal(JSON.parse(await page.locator("output").innerText()).phase, "waiting");

  await page.goto(`${parent}/?scenario=legacy-live`);
  await page.waitForFunction(() => JSON.parse(document.querySelector("output")!.textContent!).phase === "loaded");
  assert.equal(await page.locator("iframe").isVisible(), true, "A healthy legacy runtime remains supported");
  const legacyRequests = requests.get("legacy-live");
  await page.getByRole("button", { name: "Cancel chat", exact: true }).click();
  assert.equal(requests.get("legacy-live"), legacyRequests, "Changing chat state does not reload a healthy iframe");
  await page.goto(`${parent}/?scenario=transient`);
  await page.waitForFunction(() => JSON.parse(document.querySelector("output")!.textContent!).phase === "loaded");
  let state = JSON.parse(await page.locator("output").innerText());
  assert.equal(state.attempt, 1, "A failed entry module must remount once and recover");
  assert.equal(requests.get("transient"), 2);
  await page.frameLocator("iframe").getByText("Running app").waitFor();

  await page.goto(`${parent}/?scenario=delayed`);
  await page.waitForFunction(() => document.querySelector("output") !== null);
  // A forged success from the parent window has the wrong source/origin.
  await page.evaluate(() => window.postMessage({ source: "tau-preview-health", state: "loaded" }, "*"));
  state = JSON.parse(await page.locator("output").innerText());
  assert.equal(state.phase, "waiting");
  await page.waitForFunction(() => JSON.parse(document.querySelector("output")!.textContent!).phase === "loaded");
  state = JSON.parse(await page.locator("output").innerText());
  assert.equal(state.attempt, 0, "Slow mounting does not require a reload");

  await page.goto(`${parent}/?scenario=exception`);
  await page.waitForFunction(() => JSON.parse(document.querySelector("output")!.textContent!).phase === "failed");
  state = JSON.parse(await page.locator("output").innerText());
  assert.deepEqual(state, { phase: "failed", attempt: 0, appError: true });
  assert.equal(requests.get("exception"), 1, "Real exceptions do not create reload loops");
  // What went wrong reaches tau, for "Ask tau to fix": the message, where it
  // was thrown, and the stack, as paths rather than preview URLs.
  await page.waitForFunction(() => document.querySelector('[data-testid="errors"]')!.textContent !== "null");
  const reported = JSON.parse(await page.locator('[data-testid="errors"]').innerText());
  assert.equal(reported.path, "/preview?scenario=exception");
  assert.equal(reported.errors.length, 1);
  assert.equal(reported.errors[0].kind, "error");
  assert.match(reported.errors[0].message, /App bootstrap failed/);
  assert.match(reported.errors[0].at, /^\/entry\.js\?scenario=exception:1:\d+$/);
  assert.match(reported.errors[0].stack, /at start \(\/entry\.js/);
  assert.ok(!JSON.stringify(reported).includes("127.0.0.1"), "The preview origin is cut out of what is sent");
  // The same crash in a preview whose monitor was told tau lives elsewhere:
  // the state still arrives, the errors do not. A page that merely embeds a
  // preview learns that it failed and nothing about why.
  await page.goto(`${parent}/?scenario=exception-foreign`);
  await page.waitForFunction(() => JSON.parse(document.querySelector("output")!.textContent!).phase === "failed");
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal(await page.locator('[data-testid="errors"]').innerText(), "null", "Errors are posted to tau's origin only");
  await page.goto(`${parent}/?scenario=build-error`);
  await page.waitForFunction(() => JSON.parse(document.querySelector("output")!.textContent!).phase === "failed");
  state = JSON.parse(await page.locator("output").innerText());
  assert.deepEqual(state, { phase: "failed", attempt: 0, appError: true });
  assert.equal(requests.get("build-error"), 1, "A Vite error cancels a pending network retry");
  console.log("Preview recovery browser checks passed: dead URL blocked, replacement during chat, failure/cancel states, hidden 502, healthy legacy preview, failed entry, delayed rendering, forged message, runtime/Vite errors, crash details to tau only.");
} finally {
  await browser.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  assert.equal(dirname(resolve(outputDir)), resolve(tmpdir()));
  assert.ok(basename(outputDir).startsWith("tau-preview-recovery-"));
  rmSync(outputDir, { recursive: true, force: true });
}
