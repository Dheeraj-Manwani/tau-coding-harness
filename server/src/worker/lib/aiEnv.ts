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
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { log } from "./log";
import { ensureApiKey, keyEncryptionConfigured } from "@/lib/apiKeys";

export const WORK_DIR = "/home/user/app";

// ── Gateway reachability ─────────────────────────────────────────────────────

/**
 * Can a sandbox actually reach the gateway we are about to hand it?
 *
 * An E2B sandbox is a remote VM. `localhost:8080` inside it is *its own*
 * loopback, not the machine running the worker, so a loopback or RFC1918 URL is
 * guaranteed to connect-refuse — and it does so from inside a generated app,
 * where the failure surfaces as a 502 on some route the user just asked for and
 * nothing points back at the config that caused it.
 *
 * Checking the string is enough. We are not asking "is the gateway up" (that
 * changes minute to minute and a probe here would just be a slower guess); we
 * are asking "is this address the kind of address that can never work", which is
 * a property of the URL alone and is worth refusing before we mint a key.
 */
export type GatewayReachability =
  | { ok: true; aiUrl: string; apiUrl: string }
  | {
      ok: false;
      reason: "unset" | "loopback" | "private" | "malformed";
      detail: string;
    };

type HostClass = "loopback" | "private" | "public";

/** Four dotted decimal octets and nothing else. */
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * The octet ranges must be applied to IPv4 *literals* only.
 *
 * A prefix match on the raw host string looks equivalent and is not:
 * `10.example.com` and `172.16.acme.io` are ordinary public hostnames that a
 * naive `/^10\./` classifies as RFC1918 and refuses. Parse first, then judge.
 */
function classifyIpv4(octets: number[]): HostClass {
  const [a, b] = octets as [number, number, number, number];
  if (a === 127 || (a === 0 && octets.every((o) => o === 0))) return "loopback";
  if (a === 10) return "private";
  if (a === 192 && b === 168) return "private";
  if (a === 172 && b >= 16 && b <= 31) return "private";
  if (a === 169 && b === 254) return "private"; // link-local
  return "public";
}

function classifyHost(rawHost: string): HostClass {
  // URL.hostname keeps IPv6 in brackets; strip them before matching.
  const h = rawHost.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");

  const v4 = IPV4.exec(h);
  if (v4) {
    const octets = v4.slice(1).map(Number);
    // Out-of-range octets are not an IPv4 address at all; fall through to the
    // hostname rules rather than pretending to have classified it.
    if (octets.every((o) => o <= 255)) return classifyIpv4(octets);
  }

  if (h === "localhost" || h.endsWith(".localhost")) return "loopback";
  if (h === "::" || h === "::1" || h === "0:0:0:0:0:0:0:1") return "loopback";

  if (
    /^(fc|fd)[0-9a-f]{2}:/.test(h) || // IPv6 unique-local
    /^fe80:/.test(h) || // IPv6 link-local
    h.endsWith(".local") || // mDNS
    h.endsWith(".internal")
  ) {
    return "private";
  }

  return "public";
}

/**
 * @param urls Overridable for tests — `env` is a frozen module-level const, so
 * there is no other way to exercise the classification table.
 */
export function checkGatewayReachability(urls?: {
  aiUrl?: string;
  apiUrl?: string;
}): GatewayReachability {
  const aiUrl = urls ? urls.aiUrl : env.TAU_AI_URL;
  const apiUrl = urls ? urls.apiUrl : env.TAU_API_URL;

  if (!aiUrl || !apiUrl) {
    return {
      reason: "unset",
      ok: false,
      detail:
        "TAU_AI_URL and TAU_API_URL are not set. A generated app has no address to call.",
    };
  }

  for (const [name, value] of [
    ["TAU_AI_URL", aiUrl],
    ["TAU_API_URL", apiUrl],
  ] as const) {
    let host: string;
    try {
      host = new URL(value).hostname;
    } catch {
      // Unreachable for env-sourced values (zod `.url()` ran at boot), but the
      // override seam means this function no longer gets to assume that.
      return {
        ok: false,
        reason: "malformed",
        detail: `${name} is not a valid URL: ${value}`,
      };
    }

    const cls = classifyHost(host);
    if (cls !== "public") {
      return {
        ok: false,
        reason: cls,
        detail: `${name} is ${value}, a ${cls} address. An E2B sandbox is a remote VM and cannot reach it — set it to a publicly reachable origin (a tunnel in dev).`,
      };
    }
  }

  return { ok: true, aiUrl, apiUrl };
}

/**
 * The reachability verdict, with `TAU_GATEWAY_ALLOW_UNREACHABLE` applied.
 *
 * The override covers loopback/private only. An unset URL stays fatal no matter
 * what the flag says — there is no string to write into `.env`, so "carry on
 * anyway" is not a thing that can happen.
 */
export function gatewayUsable(): GatewayReachability {
  const verdict = checkGatewayReachability();
  if (verdict.ok || verdict.reason === "unset") return verdict;
  if (!env.TAU_GATEWAY_ALLOW_UNREACHABLE) return verdict;

  log.warn("ai.gateway_unreachable_allowed", { detail: verdict.detail });
  return {
    ok: true,
    aiUrl: env.TAU_AI_URL as string,
    apiUrl: env.TAU_API_URL as string,
  };
}

export class GatewayUnreachableError extends Error {
  constructor(readonly detail: string) {
    super(detail);
    this.name = "GatewayUnreachableError";
  }
}

/**
 * One error line at startup for a misconfiguration that would otherwise only
 * show up as a broken generated app, hours later, in someone else's logs.
 *
 * Silent when key encryption is off — that instance has AI disabled entirely and
 * an unset gateway URL is the correct state, not a problem.
 */
export function logGatewayReachability(): void {
  if (!keyEncryptionConfigured()) return;

  const verdict = checkGatewayReachability();
  if (verdict.ok) {
    log.info("ai.gateway_ready", { aiUrl: verdict.aiUrl });
    return;
  }
  log[env.TAU_GATEWAY_ALLOW_UNREACHABLE ? "warn" : "error"](
    "ai.unreachable_gateway",
    {
      reason: verdict.reason,
      detail: verdict.detail,
      allowedByOverride: env.TAU_GATEWAY_ALLOW_UNREACHABLE,
    },
  );
}

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
  // Before minting anything. A key handed to an app that cannot reach the
  // gateway is worse than no key: the app looks wired up, the user is told AI
  // works, and every call 502s.
  const verdict = gatewayUsable();
  if (!verdict.ok) throw new GatewayUnreachableError(verdict.detail);

  const { key } = await ensureApiKey(userId);
  return {
    TAU_API_KEY: key,
    TAU_AI_URL: verdict.aiUrl,
    TAU_API_URL: verdict.apiUrl,
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
  // Distinguished from a generic failure below: this one is a config problem on
  // tau's side, not a transient sandbox error, and it will recur on every
  // provision until someone fixes the URL.
  const verdict = gatewayUsable();
  if (!verdict.ok) {
    log.error("ai.reinject_skipped", {
      jobId,
      projectId,
      reason: "unreachable gateway",
      detail: verdict.detail,
    });
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
