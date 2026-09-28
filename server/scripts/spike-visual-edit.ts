/**
 * End-to-end check for visual edit (doc/archive/VISUAL_EDIT_PLAN.md §6).
 *
 * Started life as the Phase 0 spike and is now the standing verification for
 * the tagger. It answers:
 *
 *   Q1  Does an `enforce: "pre"` Vite plugin tag JSX with its source position
 *       ahead of @vitejs/plugin-react, inside a real E2B sandbox?
 *   Q2  Does postMessage cross the e2b.app ↔ tau origin boundary through the
 *       sandbox attribute PreviewPane.tsx puts on the iframe?
 *   Q3  (Phase 1) Does shipping `.tau/tagger.ts` leave the generated app's own
 *       `bun run build` passing, and keep the tags out of the production
 *       bundle? This one has already caught a break-every-app bug once — see
 *       VISUAL_EDIT_IMPORT_LINE in templates/shared.ts.
 *
 * It installs the *real* assets and the *real* generated vite.config, so it
 * tests the bytes the templates ship without waiting for an image rebuild.
 * Re-run it after touching templates/visual-edit/ or writeViteConfigContent.
 *
 *   bun run scripts/spike-visual-edit.ts [--keep]
 *
 * Creates one real sandbox and kills it. Costs a few cents of E2B time.
 * `--keep` leaves it alive and prints the URL, for poking at by hand.
 *
 * The browser half runs under Node, not Bun: Playwright's `launch()` can't
 * complete the CDP handshake under Bun (worker-service/src/lib/screenshot.ts
 * documents the same problem). This script shells out to it.
 */
import "@/load-env";
import { Sandbox } from "e2b";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import {
  readVisualEditAsset,
  writeViteConfigContent,
  VISUAL_EDIT_DEPS_ARGS,
} from "@/worker/templates/shared";

const TEMPLATE = "vite-spa-app"; // frontend-only: fastest boot, enough to prove it
const WORK_DIR = "/home/user/app";
const HARNESS_ORIGIN = "http://127.0.0.1:5599";
const KEEP = process.argv.includes("--keep");

const here = import.meta.dir;

// The real assets and the real generated vite.config — not copies. This script
// therefore tests the exact bytes `writeVisualEdit()` ships into the templates,
// without waiting on a full E2B image rebuild.
const TAGGER_SRC = readVisualEditAsset("tagger.ts");
const RUNTIME_SRC = readVisualEditAsset("runtime.js");

// ── The app under test ───────────────────────────────────────────────────────
// Deliberately covers the three cases the plan calls out: a plain element with
// static text (editable), elements from a .map() (shared source line), and an
// element whose content is an expression (not editable).
const APP_TSX = `import { useState } from 'react'

const CARDS = ['alpha', 'beta', 'gamma']

export default function App() {
  const [clicks, setClicks] = useState(0)
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold">Visual edit spike</h1>
      <button
        id="target"
        className="mt-4 rounded bg-blue-500 px-4 py-2 text-white"
        onClick={() => setClicks((c) => c + 1)}
      >
        Click me
      </button>
      <p id="click-count">{clicks}</p>
      <ul>
        {CARDS.map((c) => (
          <li key={c} className="spike-card">{c}</li>
        ))}
      </ul>
    </div>
  )
}
`;

/** Where `<button` actually sits, computed rather than hardcoded. */
function expectedButtonLoc(): string {
  const lines = APP_TSX.split("\n");
  const i = lines.findIndex((l) => l.trim().startsWith("<button"));
  return `src/App.tsx:${i + 1}:${lines[i].indexOf("<") + 1}`;
}

// The genuine article, straight from shared.ts. tauTagger is listed **last** in
// its plugins array on purpose: if tagging still works from there, `enforce:
// "pre"` is what orders it ahead of the React plugin rather than luck with array
// position. Note it is called with no arguments, so `parentOrigin` is "*" and
// the runtime has to discover the parent via the origin-lock handshake — which
// is exactly what production does.
const VITE_CONFIG = writeViteConfigContent({ proxyApi: false });

const results: { label: string; ok: boolean; detail?: string }[] = [];
function check(label: string, ok: boolean, detail = ""): void {
  results.push({ label, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

/**
 * `commands.run` throws `CommandExitError` on a non-zero exit, which turns a
 * check we want to *report* into a crash. This returns the result either way.
 */
async function tryRun(
  sandbox: Sandbox,
  cmd: string,
  timeoutMs = 300_000,
): Promise<{ code: number; out: string; err: string }> {
  try {
    const r = await sandbox.commands.run(cmd, { cwd: WORK_DIR, timeoutMs });
    return { code: r.exitCode, out: r.stdout, err: r.stderr };
  } catch (e: unknown) {
    const r = (
      e as { result?: { exitCode: number; stdout: string; stderr: string } }
    ).result;
    return r
      ? { code: r.exitCode, out: r.stdout, err: r.stderr }
      : { code: -1, out: "", err: String(e) };
  }
}

async function waitForVite(sandbox: Sandbox, tries = 40): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    const res = await sandbox.commands.run(
      "curl -s -o /dev/null -w '%{http_code}' http://localhost:5173/ || true",
      { cwd: WORK_DIR, timeoutMs: 15_000 },
    );
    if (res.stdout.trim() === "200") return true;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  return false;
}

console.log(`\ntau visual-edit — tagger verification\n`);

const sandbox = await Sandbox.create(TEMPLATE, { timeoutMs: 300_000 });
console.log(`sandbox ${sandbox.sandboxId} (${TEMPLATE})\n`);

try {
  // ── Install ────────────────────────────────────────────────────────────────
  console.log("installing tagger…");
  await sandbox.commands.run("mkdir -p .tau/logs", { cwd: WORK_DIR });
  await sandbox.files.write(`${WORK_DIR}/.tau/tagger.ts`, TAGGER_SRC);
  await sandbox.files.write(`${WORK_DIR}/.tau/runtime.js`, RUNTIME_SRC);
  await sandbox.files.write(`${WORK_DIR}/src/App.tsx`, APP_TSX);
  await sandbox.files.write(`${WORK_DIR}/vite.config.ts`, VITE_CONFIG);

  const add = await sandbox.commands.run(`bun add -d ${VISUAL_EDIT_DEPS_ARGS}`, {
    cwd: WORK_DIR,
    timeoutMs: 120_000,
  });
  check("tagger dependencies install", add.exitCode === 0);

  // ── Restart Vite ───────────────────────────────────────────────────────────
  // `[v]ite` is the bracket trick: `pkill -f` matches against full command
  // lines including its own shell's argv, so a bare 'vite' pattern kills the
  // pkill itself. Copied from aiEnv.ts:restartAppServer, which learned it the
  // hard way. Parens + `background: true` and NO trailing `&` for the same
  // reason documented there.
  await sandbox.commands.run("pkill -f '[v]ite' || true", {
    cwd: WORK_DIR,
    timeoutMs: 15_000,
  });
  await new Promise((r) => setTimeout(r, 1_500));
  await sandbox.commands.run("(bunx vite --host) > .tau/logs/vite.log 2>&1", {
    cwd: WORK_DIR,
    background: true,
  });

  const up = await waitForVite(sandbox);
  check("vite restarts with the tagger loaded", up);
  if (!up) {
    const logTail = await sandbox.commands.run("tail -30 .tau/logs/vite.log", {
      cwd: WORK_DIR,
    });
    console.log(`\n--- vite.log ---\n${logTail.stdout}\n`);
    throw new Error("vite did not come up");
  }

  // ── Q1: transform + ordering ───────────────────────────────────────────────
  // Vite serves the *transformed* module at its source URL. If our plugin ran
  // after React's, there would be no JSX left to tag and the attribute would be
  // absent entirely — so its presence proves both that the transform works and
  // that `enforce: "pre"` ordered it correctly.
  const served = await sandbox.commands.run(
    "curl -s http://localhost:5173/src/App.tsx",
    { cwd: WORK_DIR, timeoutMs: 20_000 },
  );
  const body = served.stdout;
  const hits = (body.match(/data-tau-loc/g) ?? []).length;

  check(
    "tagger transforms JSX ahead of @vitejs/plugin-react",
    hits > 0,
    `${hits} tags in the served module`,
  );
  check(
    "the React plugin still ran (JSX compiled away)",
    body.includes("jsxDEV") || body.includes("jsx("),
    "output is compiled JS, not raw JSX",
  );

  const wantLoc = expectedButtonLoc();
  check(
    "the emitted source location is byte-exact",
    body.includes(wantLoc),
    wantLoc,
  );

  // A syntactically broken file must not take the preview down — this is the
  // single most load-bearing property of the plugin, because the agent streams
  // files in and this transform sees invalid TSX constantly.
  await sandbox.files.write(
    `${WORK_DIR}/src/Broken.tsx`,
    "export function Broken() { return <div className=\n",
  );
  const broken = await sandbox.commands.run(
    "curl -s -o /dev/null -w '%{http_code}' http://localhost:5173/ || true",
    { cwd: WORK_DIR, timeoutMs: 20_000 },
  );
  check(
    "a half-written file does not break the dev server",
    broken.stdout.trim() === "200",
    `GET / → ${broken.stdout.trim()}`,
  );
  await sandbox.commands.run("rm -f src/Broken.tsx", { cwd: WORK_DIR });

  // THE PHASE 1 RISK: `.tau/tagger.ts` is imported by vite.config.ts, which is
  // reachable from tsconfig.node.json — so the user's own `bun run build`
  // (`tsc -b && vite build`) typechecks it. A type error in the tagger, or a
  // missing @types, would break the build of every app tau generates. It must
  // also stay out of the production bundle (`apply: "serve"`).
  const build = await tryRun(sandbox, "bun run build");
  check(
    "the app's own `bun run build` still passes with the tagger installed",
    build.code === 0,
    build.code === 0
      ? ""
      : (build.out + build.err)
          .split("\n")
          .filter((l) => l.includes("error"))
          .slice(0, 2)
          .join(" | ")
          .slice(0, 300),
  );

  const bundleTagged = await tryRun(
    sandbox,
    "grep -rl 'data-tau-loc' dist/ 2>/dev/null | head -3 || true",
    30_000,
  );
  check(
    "no tags leak into the production build",
    bundleTagged.out.trim() === "",
    bundleTagged.out.trim() || "dist/ is clean",
  );
  await tryRun(sandbox, "rm -rf dist", 30_000);

  // ── Q2: the cross-origin channel ───────────────────────────────────────────
  const host = sandbox.getHost(5173);
  const previewUrl = `https://${host}`;
  console.log(`\npreview ${previewUrl}\n`);

  console.log("browser checks (node + playwright):");
  const code = await new Promise<number>((res) => {
    const child = spawn(
      "node",
      [
        resolve(here, "spike-visual-edit-browser.mts"),
        previewUrl,
        wantLoc,
      ],
      { stdio: "inherit", cwd: resolve(here, "..") },
    );
    child.on("exit", (c) => res(c ?? 1));
  });
  check("cross-origin postMessage round-trip", code === 0);

  // ── Verdict ────────────────────────────────────────────────────────────────
  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n${failed.length === 0 ? "PASSED" : "FAILED"} — ` +
      `${results.length - failed.length}/${results.length} checks passed`,
  );
  if (failed.length) {
    for (const f of failed) console.log(`  failed: ${f.label}`);
  }

  if (KEEP) {
    console.log(`\n--keep: sandbox left alive at ${previewUrl}`);
    console.log(`        kill it with: bunx e2b sandbox kill ${sandbox.sandboxId}`);
  }

  process.exitCode = failed.length === 0 ? 0 : 1;
} finally {
  if (!KEEP) {
    await sandbox.kill();
    console.log("\nsandbox killed");
  }
}
