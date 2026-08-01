/**
 * Smoke-test every sandbox template. For each template we spin up a fresh E2B
 * pod from its published image and run the template's own "clean checks" against
 * the *scaffolded* files only — before any agent code exists:
 *
 *   - install (frozen)  bun install --frozen-lockfile   (lockfile ↔ baked deps)
 *   - lint              bun run lint                     (if the script exists)
 *   - build             bun run build                    (tsc -b && vite build)
 *   - server bundle     bun build server/index.ts …      (server templates only)
 *
 * This catches a template whose baseline no longer typechecks / builds / lints
 * after a dependency bump or a scaffold edit, without waiting for a real
 * generation to trip over it.
 *
 *   bun run check:template                    # all templates
 *   bun run check:template --key frontend     # one template by key
 *   bun run check:template --stream           # stream in-pod output live
 *   bun run check:template --keep             # leave the pods running to debug
 *
 * Valid keys: frontend | fullstack | fullstack-db (see src/templates/registry.ts).
 * Requires E2B_API_KEY (worker-service/.env, auto-loaded by Bun). Exits non-zero
 * if any check fails, so it is CI-usable.
 */
import { Sandbox } from "e2b";

import {
  TEMPLATES,
  TEMPLATE_KEYS,
  isTemplateKey,
  type TemplateKey,
} from "@/worker/templates/registry";

const WORK_DIR = "/home/user/app";
// Generous idle timeout so a pod survives every check in the run.
const SANDBOX_TIMEOUT_MS = 15 * 60_000;

interface Args {
  keys: TemplateKey[];
  keep: boolean;
  stream: boolean;
}

function parseArgs(argv: string[]): Args {
  let key: TemplateKey | undefined;
  let keep = false;
  let stream = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--key" || arg === "-k") {
      const value = argv[++i];
      if (!value) throw new Error("--key requires a value");
      if (!isTemplateKey(value)) {
        throw new Error(
          `Unknown template key "${value}". Valid keys: ${TEMPLATE_KEYS.join(", ")}`,
        );
      }
      key = value;
    } else if (arg === "--keep") {
      keep = true;
    } else if (arg === "--stream" || arg === "-v") {
      stream = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { keys: key ? [key] : [...TEMPLATE_KEYS], keep, stream };
}

interface Check {
  name: string;
  cmd: string;
  timeoutMs: number;
}

interface CheckResult {
  name: string;
  ok: boolean;
  exitCode: number;
  ms: number;
  /** Tail of stdout+stderr, only kept for failures. */
  output: string;
}

/** E2B throws CommandExitError (implements CommandResult) on a non-zero exit. */
interface CommandLike {
  exitCode?: number;
  stdout?: string;
  stderr?: string;
}

function tail(text: string, lines = 40): string {
  const all = text.split("\n");
  return all.slice(Math.max(0, all.length - lines)).join("\n");
}

function indent(text: string, pad = "      "): string {
  return text
    .split("\n")
    .map((l) => pad + l)
    .join("\n");
}

async function runCheck(
  sandbox: Sandbox,
  check: Check,
  stream: boolean,
): Promise<CheckResult> {
  const started = Date.now();
  // Accumulate everything so we still have the tail for the failure summary even
  // when streaming (E2B routes output to the callbacks, not the result).
  let buf = "";
  const sink = (data: string): void => {
    buf += data;
    if (stream) process.stdout.write(data);
  };

  try {
    const res = await sandbox.commands.run(`cd ${WORK_DIR} && ${check.cmd}`, {
      timeoutMs: check.timeoutMs,
      onStdout: sink,
      onStderr: sink,
    });
    const combined = buf || `${res.stdout}\n${res.stderr}`;
    return {
      name: check.name,
      ok: res.exitCode === 0,
      exitCode: res.exitCode,
      ms: Date.now() - started,
      output: res.exitCode === 0 ? "" : tail(combined),
    };
  } catch (err) {
    const e = err as CommandLike;
    const combined =
      (buf || `${e.stdout ?? ""}\n${e.stderr ?? ""}`).trim() || String(err);
    return {
      name: check.name,
      ok: false,
      exitCode: e.exitCode ?? 1,
      ms: Date.now() - started,
      output: tail(combined),
    };
  }
}

/**
 * Build the check list for a template. `lint`/`build` are driven off the
 * scaffold's own package.json scripts so we test exactly what ships; the server
 * bundle is added for templates that scaffold a Hono API.
 */
async function checksFor(
  sandbox: Sandbox,
  hasServer: boolean,
): Promise<Check[]> {
  let scripts: Record<string, string> = {};
  try {
    const pkgRaw = await sandbox.files.read(`${WORK_DIR}/package.json`);
    scripts = (JSON.parse(pkgRaw).scripts ?? {}) as Record<string, string>;
  } catch (err) {
    console.warn(`  (couldn't read package.json: ${String(err)})`);
  }

  const checks: Check[] = [
    {
      name: "install (frozen)",
      cmd: "bun install --frozen-lockfile",
      timeoutMs: 3 * 60_000,
    },
  ];

  if (scripts.lint) {
    checks.push({ name: "lint", cmd: "bun run lint", timeoutMs: 2 * 60_000 });
  }

  checks.push({
    name: "build",
    cmd: scripts.build ? "bun run build" : "bunx vite build",
    timeoutMs: 6 * 60_000,
  });

  if (hasServer) {
    checks.push({
      name: "server bundle",
      cmd: "bun build server/index.ts --target bun --outdir /tmp/server-dist",
      timeoutMs: 2 * 60_000,
    });
  }

  return checks;
}

interface TemplateReport {
  key: TemplateKey;
  results: CheckResult[];
  /** Set when the pod itself couldn't be created / prepared. */
  fatal?: string;
}

async function checkTemplate(
  key: TemplateKey,
  keep: boolean,
  stream: boolean,
): Promise<TemplateReport> {
  const entry = TEMPLATES[key];
  console.log(`\n▶ ${key} — creating pod from "${entry.e2bName}"…`);

  let sandbox: Sandbox;
  try {
    sandbox = await Sandbox.create(entry.e2bName, {
      timeoutMs: SANDBOX_TIMEOUT_MS,
    });
  } catch (err) {
    console.log(`  ✗ could not create pod: ${String(err)}`);
    return { key, results: [], fatal: String(err) };
  }
  console.log(`  pod ${sandbox.sandboxId} up`);

  const results: CheckResult[] = [];
  try {
    const checks = await checksFor(sandbox, entry.hasServer);
    for (const check of checks) {
      // When streaming, the check's live output follows on its own lines, so
      // print the header + result on separate lines; otherwise keep it inline.
      if (stream) console.log(`  • ${check.name}…`);
      else process.stdout.write(`  • ${check.name}… `);

      const result = await runCheck(sandbox, check, stream);
      results.push(result);

      const secs = (result.ms / 1000).toFixed(1);
      const status = result.ok
        ? `✓ (${secs}s)`
        : `✗ exit ${result.exitCode} (${secs}s)`;
      console.log(stream ? `  • ${check.name}: ${status}` : status);

      // Not streaming: the output wasn't shown live, so surface the tail here.
      if (!result.ok && result.output && !stream) {
        console.log(indent(result.output));
      }
    }
  } finally {
    if (keep) {
      console.log(`  pod ${sandbox.sandboxId} left running (--keep)`);
    } else {
      await sandbox.kill().catch(() => {});
      console.log(`  pod ${sandbox.sandboxId} killed`);
    }
  }

  return { key, results };
}

function printSummary(reports: TemplateReport[]): boolean {
  console.log(`\n${"─".repeat(56)}\nSummary\n${"─".repeat(56)}`);
  let allOk = true;

  for (const report of reports) {
    if (report.fatal) {
      allOk = false;
      console.log(`✗ ${report.key.padEnd(14)} pod error — ${report.fatal}`);
      continue;
    }
    const failed = report.results.filter((r) => !r.ok);
    const label = `${report.key.padEnd(14)}`;
    if (failed.length === 0) {
      console.log(`✓ ${label} ${report.results.length}/${report.results.length} checks passed`);
    } else {
      allOk = false;
      const names = failed.map((r) => r.name).join(", ");
      console.log(
        `✗ ${label} ${failed.length} failed: ${names}`,
      );
    }
  }

  console.log("");
  return allOk;
}

async function main(): Promise<void> {
  if (!process.env.E2B_API_KEY) {
    console.error(
      "E2B_API_KEY is not set — add it to worker-service/.env or export it before running.",
    );
    process.exit(1);
  }

  const { keys, keep, stream } = parseArgs(process.argv.slice(2));

  const reports: TemplateReport[] = [];
  for (const key of keys) {
    reports.push(await checkTemplate(key, keep, stream));
  }

  const allOk = printSummary(reports);
  process.exit(allOk ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error("\n✗ Template check run failed:", err);
  process.exit(1);
});
