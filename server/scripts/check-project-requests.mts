/** Browser regression checks using the actual project page and query hooks. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const workspace = fileURLToPath(new URL("../../", import.meta.url));
const outputDir = mkdtempSync(join(tmpdir(), "tau-project-requests-"));
const bundlePath = join(outputDir, "harness.js");
execFileSync("bun", ["build", "test/fixtures/projectRequestsHarness.tsx", "--outfile", bundlePath,
  "--define", 'import.meta.env={"VITE_API_URL":"/api","DEV":false}'],
  { cwd: resolve(workspace, "web"), stdio: "pipe" });
const bundle = readFileSync(bundlePath);
const counts = new Map<string, number>();
let revoked = false;
let pollDenied = false;
const server = createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  if (path === "/harness.js") {
    res.setHeader("Content-Type", "application/javascript"); res.end(bundle); return;
  }
  if (path.startsWith("/api/")) {
    counts.set(path, (counts.get(path) ?? 0) + 1);
    res.setHeader("Content-Type", "application/json");
    const match = path.match(/^\/api\/project\/([^/]+)(.*)$/);
    const id = match?.[1];
    const suffix = match?.[2];
    if (path === "/api/jobs/resync-job/stream" || path === "/api/jobs/job-poll-job/stream") {
      res.setHeader("Content-Type", "text/event-stream");
      if (path.includes("resync-job")) res.end('data: {"type":"resync","index":5}\n\n');
      else res.write(": connected\n\n");
      return;
    }
    if (id === "job-poll" && suffix === "/job-status") pollDenied = true;
    if (id === "forbidden" || id === "missing" || id === "unavailable" || id === "denied-poll" || (id === "live" && revoked) || (id === "resync" && counts.get(path)! > 1 && !suffix) || (id === "job-poll" && pollDenied) || path === "/api/attachments/denied-attachment" || path === "/api/credits/balance") {
      res.statusCode = id === "missing" ? 404 : id === "unavailable" ? 500 : 403;
      res.end(JSON.stringify({ error: "Cannot access this resource" })); return;
    }
    if (id && !suffix) {
      const origin = `http://${req.headers.host}`;
      const jobId = id === "resync" || id === "job-poll" ? `${id}-job` : null;
      res.end(JSON.stringify({
        project: { id, name: `${id} project`, description: null, tags: [], sandboxStatus: id === "dead" ? "DEAD" : "READY", workspaceStartedAt: "2026-10-04T00:00:00Z", previewImageUrl: null },
        messages: [], checkpoints: [], activeJobId: jobId, activeJobEventIndex: jobId ? 5 : null,
        jobState: jobId ? { id: jobId, type: "GENERATION", status: "RUNNING", phase: "working", finishReason: null, error: null, pendingQuestion: null } : null,
        latestFragment: { id: "fragment", sandboxUrl: `${origin}/preview/${id}`, title: "Preview", createdAt: "2026-10-04T00:00:00Z" },
      })); return;
    }
    if (suffix === "/preview/status") { res.end(JSON.stringify({ alive: id !== "dead", url: `http://${req.headers.host}/preview/${id}` })); return; }
    if (suffix === "/tree") { res.end(JSON.stringify({ files: [], headSequence: 0 })); return; }
    if (suffix === "/github") { res.end(JSON.stringify({ connected: false })); return; }
    if (suffix === "/deploy") { res.end(JSON.stringify({ inProgress: false, deployments: [], unpublishedChanges: 0 })); return; }
    if (path === "/api/auth/me") {
      res.end(JSON.stringify({ user: { id: "user", email: "test@example.test", name: "User", emailVerifiedAt: "2026-10-04", preferences: { hasSeenMotionIntro: true, reduceMotion: true, tours: { workspace: { version: 1 }, preview: { version: 1 } } } } })); return;
    }
    res.end("{}"); return;
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  if (path.startsWith("/preview/")) {
    const previewPath = path.replace(/\/+$/, "");
    counts.set(previewPath, (counts.get(previewPath) ?? 0) + 1);
    res.end('<h1>Running app</h1><script>window.parent.postMessage({source:"tau-visual-edit",type:"tau:ready"},"*");</script>'); return;
  }
  res.end('<html><body><div id="root"></div><script type="module" src="/harness.js"></script></body></html>');
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 900, height: 800 } });
  const errors: string[] = [];
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  for (const scenario of ["forbidden", "missing", "unavailable"]) {
    await page.goto(`${origin}/?scenario=${scenario}`);
    await page.getByRole("alert").waitFor();
    await page.waitForTimeout(700);
    assert.equal(counts.get(`/api/project/${scenario}`), 1, "A failed project fetch must not loop through chat/header mounts");
    if (scenario === "forbidden") {
      await page.getByRole("button", { name: "Simulate tab focus" }).click();
      await page.waitForTimeout(150);
      assert.equal(counts.get("/api/project/forbidden"), 1, "Tab focus must not retry denied access");
      await page.getByRole("button", { name: "Try again", exact: true }).click();
      await page.getByRole("alert").waitFor();
      assert.equal(counts.get("/api/project/forbidden"), 2, "An explicit retry makes one request");
    }
  }
  // Two pages share an origin but keep their project/preview state independent.
  const live = await context.newPage();
  const dead = await context.newPage();
  for (const tab of [live, dead]) tab.on("pageerror", (error) => errors.push(error.message));
  await live.goto(`${origin}/?scenario=live`);
  await dead.goto(`${origin}/?scenario=dead`);
  await live.frameLocator("iframe").getByText("Running app").waitFor({ state: "attached" });
  await dead.getByText("Preview stopped", { exact: true }).waitFor();
  assert.equal(await dead.locator("iframe").count(), 0);
  assert.equal(counts.get("/api/project/live"), 1, "The live header observes the existing fetch");
  assert.equal(counts.get("/api/project/dead"), 1, "The dead header observes the existing fetch");
  await dead.clock.install();
  await dead.clock.runFor(61_000);
  assert.equal(counts.get("/api/project/dead/preview/status"), 1, "Stopped previews do not poll indefinitely");
  assert.equal(counts.get("/preview/dead") ?? 0, 0, "The dead sandbox is never navigated to");
  await live.bringToFront();
  await live.getByRole("button", { name: "Simulate tab focus" }).click();
  await live.clock.install();
  const healthyCheck = live.waitForResponse((response) => response.url().endsWith("/api/project/live/preview/status"));
  await live.clock.runFor(31_000);
  await healthyCheck;
  assert.ok(counts.get("/api/project/live/preview/status")! > 1, "Healthy preview liveness checks still run");
  assert.equal(counts.get("/preview/live"), 1, "Healthy liveness polling keeps the same iframe");
  revoked = true;
  await live.getByRole("button", { name: "Simulate tab focus" }).click();
  await live.getByRole("alert").getByText("You don’t have access to this project.").waitFor();
  assert.equal(await live.locator("iframe").count(), 0, "Losing access hides a previously cached workspace");
  const deniedCount = counts.get("/api/project/live");
  await live.getByRole("button", { name: "Simulate tab focus" }).click();
  await live.waitForTimeout(150);
  assert.equal(counts.get("/api/project/live"), deniedCount);
  const resync = await context.newPage();
  resync.on("pageerror", (error) => errors.push(error.message));
  await resync.goto(`${origin}/?scenario=resync`);
  await resync.getByText("Cannot access this resource").waitFor();
  await resync.waitForTimeout(150);
  const streamCount = counts.get("/api/jobs/resync-job/stream");
  const detailCount = counts.get("/api/project/resync");
  await resync.clock.install();
  await resync.clock.runFor(21_000);
  assert.equal(counts.get("/api/jobs/resync-job/stream"), streamCount, "A denied resync does not reconnect the stream");
  assert.equal(counts.get("/api/project/resync"), detailCount, "A denied resync does not loop detail requests");
  const jobPoll = await context.newPage();
  jobPoll.on("pageerror", (error) => errors.push(error.message));
  await jobPoll.goto(`${origin}/?scenario=job-poll`);
  await jobPoll.frameLocator("iframe").getByText("Running app").waitFor({ state: "attached" });
  await jobPoll.clock.install();
  await jobPoll.clock.runFor(6_100);
  await jobPoll.getByRole("alert").getByText("You don’t have access to this project.").waitFor();
  await jobPoll.clock.runFor(21_000);
  assert.equal(counts.get("/api/project/job-poll/job-status"), 1, "The job backstop stops on denied access");
  assert.equal(counts.get("/api/project/job-poll"), 2, "The job backstop refreshes the access state only once");
  await page.goto(`${origin}/?scenario=denied-poll`);
  await page.waitForFunction(() => {
    const state = JSON.parse(document.querySelector("output")!.textContent!);
    return state.preview === "error" && state.deploy === "error" && state.balance === "error";
  });
  await page.waitForFunction(() => JSON.parse(document.querySelector("output")!.textContent!).attachment === "FAILED");
  await page.clock.install();
  const pollPaths = ["/api/project/denied-poll/preview/status", "/api/project/denied-poll/deploy", "/api/credits/balance", "/api/attachments/denied-attachment"];
  const before = pollPaths.map((path) => counts.get(path));
  await page.clock.runFor(125_000);
  assert.deepEqual(pollPaths.map((path) => counts.get(path)), before, "Denied preview, deploy, balance and attachment polls stop");
  assert.deepEqual(errors, []);
  await context.close();
  console.log("Project request checks passed: bounded 403/404/500 loads, explicit retry, cache-only header, separate live/dead tabs, healthy/stopped preview polling, revoked access, stream resync and job-poll denial, terminal polling errors.");
} finally {
  await browser.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (dirname(resolve(outputDir)) === resolve(tmpdir()) && basename(outputDir).startsWith("tau-project-requests-")) rmSync(outputDir, { recursive: true, force: true });
}
