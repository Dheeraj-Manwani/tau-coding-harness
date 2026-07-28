/**
 * Getting `TAU_API_KEY` into a generated app's running server.
 *
 * ## Why this is not just `Sandbox.create({ envs })`
 *
 * Phase S spike (`scripts/spike-e2b-envs.ts`, run 2026-07-28 against
 * `vite-hono-app`) measured exactly what sandbox `envs` reach:
 *
 *   YES  a command we run later sees them
 *   NO   the process started by the template's `setStartCmd` inherits them
 *   YES  a freshly-started Bun process auto-loads `.env` from the workdir
 *
 * The Hono API boots from `setStartCmd` when the sandbox is created, so it does
 * **not** see `envs`. That kills the "just pass envs" design. What works is to
 * write a `.env` and restart the server process, which is what this module does.
 *
 * ## Why the `.env` is never persisted
 *
 * `isSecretPath` keeps `.env` out of the `ProjectFile` manifest, because the
 * manifest is what `pushProjectToGithub` commits — persisting it would publish
 * the user's key (doc/AI_FOR_GENERATED_APPS.md §7.1). The cost of that choice is
 * that the file does not come back from R2 on rehydrate, so `Project.aiEnabled`
 * exists to tell us to write it again on every provision.
 */
import type { Sandbox } from "e2b";
import { prisma } from "./prisma";
import { env } from "./env";
import { log } from "./log";
import { ensureApiKey, keyEncryptionConfigured } from "./apiKeys";

export const WORK_DIR = "/home/user/app";

/** Env vars a generated app reads to reach the tau gateway. The index signature
 *  is what lets this be handed straight to E2B's `envs`. */
export interface AiEnv extends Record<string, string> {
  TAU_API_KEY: string;
  /** Base for the plain-`fetch` surface — `${TAU_AI_URL}/chat`. The default. */
  TAU_AI_URL: string;
  /** OpenAI-compatible base, for an app that would rather use the SDK. */
  TAU_API_URL: string;
  TAU_PROJECT_ID: string;
}

export async function buildAiEnv(
  userId: string,
  projectId: string,
): Promise<AiEnv> {
  const { key } = await ensureApiKey(userId);
  return {
    TAU_API_KEY: key,
    TAU_AI_URL: env.TAU_AI_URL,
    TAU_API_URL: env.TAU_API_URL,
    TAU_PROJECT_ID: projectId,
  };
}

function renderDotenv(vars: AiEnv): string {
  return (
    "# Managed by tau. Do not edit or commit.\n" +
    "# This file is intentionally not saved with your project — tau rewrites it\n" +
    "# each time the app starts, and it is never pushed to GitHub.\n" +
    Object.entries(vars)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") +
    "\n"
  );
}

/**
 * Write `.env` straight to the sandbox filesystem.
 *
 * Uses `sandbox.files.write` and NOT `persistFile`, deliberately: persisting
 * would put the key in R2 and the manifest, and from there into the user's
 * GitHub repo on the next push.
 */
export async function writeAiEnvFile(
  sandbox: Sandbox,
  vars: AiEnv,
): Promise<void> {
  await sandbox.files.write(`${WORK_DIR}/.env`, renderDotenv(vars));
}

/**
 * Restart the Hono process so it picks up the new `.env`.
 *
 * Bun reads `.env` once at process start, so an already-running server will
 * never see a newly written file. This is the documented exception to the
 * agent's "NEVER restart the dev server" rule (`agent/config.ts`) — and it is
 * confined here rather than left to the model.
 *
 * Only the API process is touched. Vite keeps running, so the preview URL and
 * the browser's hot-reload connection both survive.
 */
export async function restartAppServer(
  sandbox: Sandbox,
  jobId: string,
): Promise<void> {
  try {
    await sandbox.commands.run("mkdir -p .tau/logs", { cwd: WORK_DIR });

    // `[s]erver` is the bracket trick, and it is load-bearing. `pkill -f` matches
    // against full command lines — including the argv of the very shell running
    // the pkill. A plain 'server/index.ts' pattern therefore matches itself and
    // the command dies with `signal: terminated` before killing anything.
    // `[s]erver/index.ts` matches the server's command line but not the literal
    // text in our own.
    await sandbox.commands.run("pkill -f '[s]erver/index.ts' || true", {
      cwd: WORK_DIR,
      timeoutMs: 15_000,
    });

    // Parens + `background: true` and NO trailing `&`, exactly how
    // run-command.ts launches long-running processes. Doing both (a `&` inside
    // an already-backgrounded command) exits the wrapping shell immediately and
    // takes the server down with it.
    await sandbox.commands.run(
      "(bun --watch server/index.ts) > .tau/logs/server.log 2>&1",
      { cwd: WORK_DIR, background: true },
    );

    // Don't report success until it is actually serving: a restart that leaves
    // the API dead is worse than not restarting, and the agent's next step is
    // usually to curl the route it just wrote.
    const ready = await waitForApi(sandbox);
    if (ready) log.info("ai.server_restarted", { jobId });
    else log.warn("ai.server_restart_unconfirmed", { jobId });
  } catch (err) {
    // Not fatal: the next full rebuild boots with the .env already in place.
    log.warn("ai.server_restart_failed", { jobId, error: String(err) });
  }
}

/** Poll `/api/health` until the restarted Hono process answers. */
async function waitForApi(sandbox: Sandbox, timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await sandbox.commands.run(
        "curl -s -o /dev/null -w '%{http_code}' --max-time 2 http://localhost:3000/api/health || true",
        { cwd: WORK_DIR, timeoutMs: 10_000 },
      );
      if (res.stdout.trim() === "200") return true;
    } catch {
      // Keep polling — a refused connection here is expected while it boots.
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

/**
 * Re-inject on provision for a project that already has AI enabled.
 *
 * Called from `provisionSandbox` after rehydration. No restart is needed on a
 * fresh sandbox whose files were just rehydrated — `bun --watch` reboots the
 * server when `server/index.ts` lands anyway, and by then `.env` is on disk.
 * A reconnect to a live sandbox is the case that needs the explicit restart.
 */
export async function reinjectAiEnv(
  sandbox: Sandbox,
  projectId: string,
  userId: string,
  jobId: string,
  opts: { restart: boolean },
): Promise<void> {
  if (!keyEncryptionConfigured()) {
    log.warn("ai.reinject_skipped", { jobId, projectId, reason: "no enc key" });
    return;
  }
  try {
    const vars = await buildAiEnv(userId, projectId);
    await writeAiEnvFile(sandbox, vars);
    if (opts.restart) await restartAppServer(sandbox, jobId);
    log.info("ai.env_injected", { jobId, projectId });
  } catch (err) {
    log.warn("ai.env_inject_failed", {
      jobId,
      projectId,
      error: String(err),
    });
  }
}

/** Has the agent turned on AI for this project? */
export async function isAiEnabled(projectId: string): Promise<boolean> {
  const p = await prisma.project.findUnique({
    where: { id: projectId },
    select: { aiEnabled: true },
  });
  return p?.aiEnabled ?? false;
}
