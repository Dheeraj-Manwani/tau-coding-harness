/**
 * The steps only a full-stack publish has (doc/PUBLISHING.md section 4): deciding
 * whether a project's server is hosted, building the environment its function
 * runs with, and checking the new backend answers before anything points at it.
 *
 * `runDeployJob` calls these in order around the steps a static publish also has,
 * so the two paths share their frontend half and differ only in what is here.
 */
import { AwsClient } from "aws4fetch";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { TEMPLATES, toTemplateKey } from "@/worker/templates/registry";
import { backendHostingAvailable, hostingConfig, recentBackendLogs } from "@/lib/lambdaApps";
import { buildProjectEnv } from "./aiEnv";
import { DeployError } from "./deploy";
import type { Level } from "./deployPreflight";

/** What a project is, from its template: how much of it there is to publish. */
export function levelOfTemplate(templateKey: string): Level {
  const template = TEMPLATES[toTemplateKey(templateKey)];
  return template.hasDb ? "database" : template.hasServer ? "api" : "frontend";
}

/**
 * Whether this publish also publishes a backend.
 *
 * Only a project with a server, and only where backend hosting is on and fully
 * configured. Everywhere else (the default, and every laptop) a publish is the
 * static one, exactly as before.
 */
export function publishesBackend(level: Level): boolean {
  return level !== "frontend" && backendHostingAvailable();
}

export interface PublishEnv {
  /** What the function is given: the project's keys, tau's AI variables if AI is on, and NODE_ENV. */
  vars: Record<string, string>;
  secretNames: string[];
  /** Byte length of each value, for the 4 KB check. */
  valueBytes: Record<string, number>;
}

/**
 * The environment a published function runs with.
 *
 * The same variables the sandbox's `.env` has (`buildProjectEnv`), so an app
 * behaves the same published as in preview, plus `NODE_ENV=production`. Values
 * go into the function's encrypted configuration, never into the bundle.
 */
export async function buildPublishEnv(args: {
  userId: string;
  projectId: string;
  jobId: string;
  aiEnabled: boolean;
  storageEnabled: boolean;
}): Promise<PublishEnv> {
  // A published app gets the LIVE storage key, never the preview one the sandbox
  // has: live and preview files are separate stores (doc/TAU_CLOUD_STORAGE.md D4).
  const base = await buildProjectEnv(args.userId, args.projectId, args.jobId, {
    aiEnabled: args.aiEnabled,
    storage: args.storageEnabled ? "LIVE" : null,
  });
  // Unlike the preview, where a missing key is logged and skipped, a publish
  // refuses: an app that went live and cannot store a file is worse than none.
  if (args.storageEnabled && !base.TAU_STORAGE_KEY) {
    throw new DeployError("File storage is not available right now, so this app cannot be published. Try again in a few minutes.");
  }
  const vars = { ...base, NODE_ENV: "production" };
  const secrets = await prisma.projectSecret.findMany({ where: { projectId: args.projectId }, select: { name: true } });
  return {
    vars,
    secretNames: secrets.map((s) => s.name),
    valueBytes: Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, Buffer.byteLength(v)])),
  };
}

// ── Verifying the candidate ──────────────────────────────────────────────────

interface VerifyDeps {
  fetcher: typeof fetch;
  sleep: (ms: number) => Promise<void>;
}

const realVerifyDeps: VerifyDeps = { fetcher: fetch, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };
let verifyDeps = realVerifyDeps;

/** Tests hand in their own. Pass null to put the real ones back. */
export function setVerifyDepsForTests(next: Partial<VerifyDeps> | null): void {
  verifyDeps = next ? { ...realVerifyDeps, ...next } : realVerifyDeps;
}

/** A new alias's URL can take a few seconds to start answering, so a first refusal is not final. */
const VERIFY_ATTEMPTS = 8;
const VERIFY_DELAY_MS = 3_000;
const VERIFY_TIMEOUT_MS = 25_000;

/**
 * Call the candidate backend's health route with tau's own signed request, and
 * require a 200, before the routing record points anyone at it.
 *
 * The router's credential is not used: tau's server has its own, which is why
 * the function URL needs no other way in. On failure the function's recent log
 * lines go into the error's build log, so "Fix with tau" is handed the server's
 * own error instead of a status code.
 */
export async function verifyBackend(args: { projectId: string; url: string; startedAtMs: number }): Promise<void> {
  const config = hostingConfig();
  if (!config) throw new Error("Backend hosting is not configured.");
  const aws = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: "lambda",
    region: config.region,
  });

  let last: string = "no answer";
  for (let attempt = 1; attempt <= VERIFY_ATTEMPTS; attempt++) {
    try {
      const signed = await aws.sign(`${args.url}/api/health`, { method: "GET" });
      const res = await verifyDeps.fetcher(signed, { signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS) });
      await res.body?.cancel().catch(() => {});
      if (res.status === 200) return;
      last = `status ${res.status}`;
      // A 5xx is the app failing, and will not get better by waiting; AWS refusing
      // the request (403) or the URL not yet live (404) can.
      if (res.status >= 500) break;
    } catch (err) {
      last = err instanceof Error && err.name === "TimeoutError" ? "no answer in time" : "no answer";
    }
    if (attempt < VERIFY_ATTEMPTS) await verifyDeps.sleep(VERIFY_DELAY_MS);
  }

  const logs = await recentBackendLogs(args.projectId, args.startedAtMs);
  throw new DeployError(
    last.startsWith("status 5")
      ? `Your server was published, but its health check failed (${last}). Nothing was switched over, so your site is as it was. Ask the agent to fix the error, then publish again.`
      : `Your server was published, but it didn't answer its health check (${last}). Nothing was switched over, so your site is as it was. Publish again in a minute; if it keeps happening, ask the agent to check the server.`,
    logs || undefined,
  );
}

/** Whether `url` is a Lambda function URL, for a last check before it is stored. */
export function isFunctionUrl(url: string): boolean {
  return /^https:\/\/[a-z0-9]+\.lambda-url\.[a-z0-9-]+\.on\.aws$/.test(url);
}

/** Where tau's own settings say the apps live, for logs. */
export function hostingRegion(): string | null {
  return env.AWS_APPS_REGION ?? null;
}
