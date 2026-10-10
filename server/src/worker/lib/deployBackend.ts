/**
 * The backend half of a full-stack publish, up to the point it has to touch AWS:
 * is the server publishable, can it be bundled, and does the bundle start the way
 * a published app starts (doc/PUBLISHING.md C3, C13).
 *
 * Everything happens in the project's own sandbox, on a scratch copy, so the
 * owner's files are never edited and the entry file and the swapped database
 * client written for publishing never appear in their project. Tau's server
 * then reads the zip out; the sandbox holds no cloud credentials (D4).
 *
 * The smoke test is the answer to "preview runs on Bun and production runs on
 * Node": it installs Node into the sandbox for the length of a publish (about
 * three seconds, from the official tarball) and runs the real bundle under it,
 * through a faithful stand-in for Lambda's streaming handler interface. A
 * server that only works on Bun fails here, with a log the agent can act on,
 * instead of on a live URL.
 */
import { zipSync } from "fflate";
import { env } from "@/lib/env";
import { log } from "./log";
import { WORK_DIR, type Sandbox } from "./sandbox";
import { databaseHostingAvailable } from "@/lib/neonApps";
import { DeployError } from "./deploy";
import { lambdaEntry } from "./deployTransforms";
import { preflight, type Issue, type Level, type PreflightReport } from "./deployPreflight";

/** Pinned: Lambda's current managed runtime (`nodejs24.x`) and what Phase 1 measured. */
export const NODE_VERSION = "v24.21.0";

export const SCRATCH_DIR = ".tau/publish";
const BUNDLE_PATH = `${SCRATCH_DIR}/out/index.mjs`;

/** Where the function handler is, as Lambda names it: file `index`, export `handler`. */
export const HANDLER = "index.handler";

/** Largest source file read for preflight. A file over this is not code the app wrote by hand. */
const MAX_SOURCE_BYTES = 400_000;
const BUILD_LOG_TAIL = 4_000;

async function run(sandbox: Sandbox, command: string, timeoutMs: number): Promise<{ exitCode: number; output: string }> {
  try {
    const res = await sandbox.commands.run(command, { cwd: WORK_DIR, timeoutMs });
    return { exitCode: res.exitCode ?? 0, output: `${res.stdout ?? ""}${res.stderr ?? ""}` };
  } catch (err) {
    // e2b throws on a non-zero exit and carries the streams on the error.
    const e = err as { exitCode?: number; stdout?: string; stderr?: string };
    if (typeof e?.exitCode === "number" || e?.stderr !== undefined) {
      return { exitCode: e.exitCode ?? 1, output: `${e.stdout ?? ""}${e.stderr ?? ""}` || String(err) };
    }
    throw err;
  }
}

const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;
function tail(text: string): string {
  const plain = text.replace(ANSI, "");
  return plain.length <= BUILD_LOG_TAIL ? plain : `…\n${plain.slice(-BUILD_LOG_TAIL)}`;
}

// ── Preflight, read from the sandbox ─────────────────────────────────────────

/** `package.json` and every source file under `server/`, as `deployPreflight` takes them. */
export async function readPreflightFiles(sandbox: Sandbox): Promise<Record<string, string>> {
  const listing = await run(
    sandbox,
    "find server -type f \\( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.mjs' -o -name '*.cjs' \\) -not -path '*/node_modules/*' -printf '%s\\t%p\\n'",
    30_000,
  );
  const wanted = listing.output
    .split("\n")
    .map((line) => line.split("\t"))
    .filter(([size, path]) => path && Number(size) <= MAX_SOURCE_BYTES)
    .map(([, path]) => path!.trim());

  const files: Record<string, string> = {};
  const read = async (path: string) => {
    try {
      files[path] = await sandbox.files.read(`${WORK_DIR}/${path}`);
    } catch {
      // A file that vanished between the listing and the read is not worth failing for.
    }
  };
  for (let i = 0; i < wanted.length; i += 8) await Promise.all(wanted.slice(i, i + 8).map(read));
  await read("package.json");
  return files;
}

/** The sentence a failed validation shows the owner: every blocker, as a list. */
export function blockersMessage(blockers: Issue[]): string {
  if (blockers.length === 1) return blockers[0]!.message;
  return `Your server can't be published yet:\n${blockers.map((b) => `- ${b.message}`).join("\n")}`;
}

/**
 * Check the project can be published, before anything is built.
 *
 * Throws {@link DeployError} with every blocker; returns the report (with its
 * warnings) otherwise. A database app is refused here for now: its hosting is a
 * later phase, and publishing it with the preview's database would lose data.
 */
export async function validateBackend(
  sandbox: Sandbox,
  opts: { level: Level; secretNames: string[]; aiEnabled: boolean; storageEnabled: boolean; envValueBytes: Record<string, number> },
): Promise<PreflightReport> {
  const report = preflight({ ...opts, files: await readPreflightFiles(sandbox) });
  const blockers = [...report.blockers];
  if (opts.level === "database" && !databaseHostingAvailable()) {
    blockers.push({
      code: "database_hosting_unavailable",
      message: "Hosting for apps with a database is coming soon. For now, publish the front end only, or export your project and host it elsewhere.",
    });
  }
  if (blockers.length > 0) throw new DeployError(blockersMessage(blockers));
  return report;
}

// ── The scratch copy, the bundle, the zip ────────────────────────────────────

/**
 * A stand-in for Lambda's response-streaming runtime, and a client for it.
 *
 * Lambda provides a global `awslambda` with `streamifyResponse` and
 * `HttpResponseStream`; Hono's `streamHandle` is written against exactly that.
 * This implements those two with the real call shapes, loads the bundle the way
 * Lambda does (importing it once, so top-level `await` runs at load), sends one
 * GET `/api/health` as a Function URL (payload v2) event, collects the streamed
 * response and prints one JSON line. Run with the same Node as production.
 */
export const LAMBDA_SMOKE_HARNESS = `
import { Writable } from 'node:stream'
const chunks = []
let meta
// A real Writable, as Lambda's response stream is: Hono pipes the response into
// it with stream.pipeline, which a plain object would make throw after the
// status line was already set, leaving a 200 with an error for a body.
const sink = new Writable({
  write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done() },
})
// Hono catches a handler's error, writes "Internal Server Error" and carries on,
// so the only trace of it is this log line. Remember it: it must fail the check.
let handlerError = null
const logError = console.error
console.error = (...args) => {
  if (String(args[0]).includes('Error processing request')) handlerError = String(args[1]?.stack ?? args[1] ?? 'unknown')
  logError(...args)
}
globalThis.awslambda = {
  streamifyResponse: (fn) => fn,
  HttpResponseStream: { from(stream, m) { meta = m; return stream } },
}
const started = Date.now()
const mod = await import(process.argv[2])
const loaded = Date.now() - started
const event = {
  version: '2.0',
  routeKey: '$default',
  rawPath: '/api/health',
  rawQueryString: '',
  headers: { host: 'smoke.lambda-url.local', 'x-forwarded-proto': 'https' },
  requestContext: {
    accountId: 'anonymous',
    domainName: 'smoke.lambda-url.local',
    http: { method: 'GET', path: '/api/health', protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'tau-smoke' },
    requestId: 'smoke',
    stage: '$default',
    time: new Date().toISOString(),
    timeEpoch: Date.now(),
  },
  isBase64Encoded: false,
}
// Optional: a second argument is a JSON object that overrides the request
// (path, method, headers, body), so the same harness can exercise more than the
// health check. The publish itself never passes one.
const override = process.argv[3] ? JSON.parse(process.argv[3]) : {}
if (override.path) { event.rawPath = override.path; event.requestContext.http.path = override.path }
if (override.method) event.requestContext.http.method = override.method
if (override.headers) event.headers = { ...event.headers, ...override.headers }
if (override.body !== undefined) event.body = override.body
await mod.handler(event, sink, { awsRequestId: 'smoke', getRemainingTimeInMillis: () => 15000 })
if (!sink.writableFinished) await new Promise((resolve) => sink.once('finish', resolve))
console.log(JSON.stringify({ status: meta?.statusCode ?? null, body: Buffer.concat(chunks).toString('utf8').slice(0, 2000), loadedMs: loaded, handlerError }))
process.exit(0)
`;

export interface SmokeResult {
  ok: boolean;
  status: number | null;
  loadedMs: number | null;
  /** What the process printed, for the build log when it failed. */
  output: string;
}

/** Parse the harness's single JSON line out of whatever else the app printed. */
export function parseSmokeOutput(output: string): SmokeResult {
  const line = output
    .split("\n")
    .reverse()
    .find((l) => l.trim().startsWith("{") && l.includes('"status"'));
  if (!line) return { ok: false, status: null, loadedMs: null, output };
  try {
    const parsed = JSON.parse(line) as { status: number | null; loadedMs?: number; handlerError?: string | null };
    // A 200 is not enough: an error inside the handler still ends with the status already sent.
    return { ok: parsed.status === 200 && !parsed.handlerError, status: parsed.status, loadedMs: parsed.loadedMs ?? null, output };
  } catch {
    return { ok: false, status: null, loadedMs: null, output };
  }
}

async function ensureNode(sandbox: Sandbox): Promise<void> {
  const have = await run(sandbox, "export PATH=$HOME/.node/bin:$PATH; node --version", 15_000);
  if (have.exitCode === 0 && have.output.trim() === NODE_VERSION) return;
  const got = await run(
    sandbox,
    `mkdir -p $HOME/.node && curl -fsSL https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-linux-x64.tar.gz | tar -xz -C $HOME/.node --strip-components=1`,
    120_000,
  );
  if (got.exitCode !== 0) throw new Error(`Could not install Node ${NODE_VERSION} in the sandbox: ${got.output.slice(-300)}`);
}

/** The bundle step for an app with a database: the same build, with `pg` found where it was installed. */
export const PG_BUILD_SCRIPT = `
const pg = process.cwd() + '/server/db/node_modules/pg/lib/index.js'
const result = await Bun.build({
  entrypoints: ['server/lambda.ts'],
  target: 'node',
  format: 'esm',
  outdir: 'out',
  naming: 'index.mjs',
  plugins: [{ name: 'pg', setup(build) { build.onResolve({ filter: /^pg$/ }, () => ({ path: pg })) } }],
})
if (!result.success) {
  for (const log of result.logs) console.error(String(log))
  process.exit(1)
}
`;

export interface BackendBundle {
  /** The deployable zip: one file, `index.mjs`. */
  zip: Uint8Array;
  bundleBytes: number;
  zipBytes: number;
  smoke: SmokeResult;
}

/**
 * Copy the app, write the entry, bundle it for Node, prove it starts, zip it.
 *
 * Throws {@link DeployError} for what the owner can fix: the bundler failing
 * (usually an import that does not resolve), a bundle over the size cap, or a
 * server that does not start under Node.
 */
export async function buildBackendBundle(
  sandbox: Sandbox,
  opts: {
    jobId: string;
    projectId: string;
    envFileExists?: boolean;
    /** An app with a database: its production client, and the connection string to start it against. */
    database?: { clientTs: string; url: string };
  },
): Promise<BackendBundle> {
  // Reuse node_modules by link rather than copying it; leave out what must not
  // travel (local database, secrets, git history, earlier build output).
  const copy = await run(
    sandbox,
    `rm -rf ${SCRATCH_DIR} && mkdir -p ${SCRATCH_DIR} && tar -cf - --exclude=./node_modules --exclude=./data --exclude=./.env --exclude=./.env.* --exclude=./.git --exclude=./dist --exclude=./.tau/publish --exclude=./.tau/logs . | tar -xf - -C ${SCRATCH_DIR} && ln -s "$PWD/node_modules" ${SCRATCH_DIR}/node_modules`,
    90_000,
  );
  if (copy.exitCode !== 0) throw new Error(`Could not prepare the publish copy: ${copy.output.slice(-300)}`);

  await sandbox.files.write(`${WORK_DIR}/${SCRATCH_DIR}/server/lambda.ts`, lambdaEntry());

  if (opts.database) {
    // The preview's database file is replaced by the one on `pg`, and `pg` is
    // installed beside it (not into the app's own node_modules, which the copy
    // only links to), so the bundler finds it first.
    await sandbox.files.write(`${WORK_DIR}/${SCRATCH_DIR}/server/db/client.ts`, opts.database.clientTs);
    // Its own package.json, or `bun add` would edit the app's (the nearest one above).
    await sandbox.files.write(`${WORK_DIR}/${SCRATCH_DIR}/server/db/package.json`, '{"name":"tau-db","private":true}');
    const added = await run(sandbox, `cd ${SCRATCH_DIR}/server/db && bun add pg@8 2>&1`, 120_000);
    if (added.exitCode !== 0) {
      throw new Error(`Could not add the Postgres driver to the publish copy: ${added.output.slice(-300)}`);
    }
  }

  // With a database, drizzle's own files (under the app's real node_modules,
  // where the link points) ask for `pg`, and from there it is not to be found:
  // it was installed beside the client. So `pg` is resolved by hand.
  let bundleCommand = `cd ${SCRATCH_DIR} && bun build server/lambda.ts --target=node --format=esm --outfile=out/index.mjs`;
  if (opts.database) {
    await sandbox.files.write(`${WORK_DIR}/${SCRATCH_DIR}/build.mjs`, PG_BUILD_SCRIPT);
    bundleCommand = `cd ${SCRATCH_DIR} && bun build.mjs`;
  }
  const bundled = await run(sandbox, bundleCommand, 180_000);
  if (bundled.exitCode !== 0) {
    throw new DeployError(
      "Your server could not be bundled for publishing. Ask the agent to fix the errors, then publish again.",
      tail(bundled.output),
    );
  }

  const sized = await run(sandbox, `stat -c %s ${BUNDLE_PATH}`, 15_000);
  const bundleBytes = Number(sized.output.trim());
  if (!Number.isFinite(bundleBytes) || bundleBytes === 0) {
    throw new DeployError("Bundling your server produced nothing.", tail(bundled.output));
  }
  if (bundleBytes > env.DEPLOY_MAX_BACKEND_BYTES) {
    throw new DeployError(
      `Your server bundles to ${mib(bundleBytes)}, over the ${mib(env.DEPLOY_MAX_BACKEND_BYTES)} limit. A very large dependency is the usual cause.`,
      tail(bundled.output),
    );
  }

  // Prove it starts under the runtime it will be published on.
  await ensureNode(sandbox);
  await sandbox.files.write(`${WORK_DIR}/${SCRATCH_DIR}/smoke.mjs`, LAMBDA_SMOKE_HARNESS);
  const envFile = opts.envFileExists === false ? "" : "--env-file-if-exists=/home/user/app/.env";
  // The app starts against its real database, so a server that cannot reach it
  // fails here and not in front of visitors. The file is deleted straight after.
  const smokeEnv = ".smoke.env";
  if (opts.database) {
    await sandbox.files.write(`${WORK_DIR}/${SCRATCH_DIR}/${smokeEnv}`, `DATABASE_URL=${opts.database.url}
`);
  }
  const dbEnvFile = opts.database ? `--env-file=${smokeEnv}` : "";
  const ran = await run(
    sandbox,
    `export PATH=$HOME/.node/bin:$PATH; cd ${SCRATCH_DIR} && NODE_ENV=production timeout 40 node ${envFile} ${dbEnvFile} smoke.mjs ${"./out/index.mjs"} 2>&1; rm -f ${smokeEnv}`,
    60_000,
  );
  const smoke = parseSmokeOutput(ran.output);
  if (!smoke.ok) {
    log.warn("deploy.backend.smoke_failed", { jobId: opts.jobId, projectId: opts.projectId, status: smoke.status });
    throw new DeployError(
      smoke.status === null
        ? "Your server doesn't start the way a published app runs it. It may rely on something that only works while you are building. Ask the agent to fix it, then publish again."
        : `Your server started, but GET /api/health answered ${smoke.status} instead of 200. Ask the agent to fix it, then publish again.`,
      tail(ran.output),
    );
  }

  const bytes = (await sandbox.files.read(`${WORK_DIR}/${BUNDLE_PATH}`, { format: "bytes" })) as Uint8Array;
  const zip = zipSync({ "index.mjs": [bytes, { level: 6 }] });
  log.info("deploy.backend.bundled", {
    jobId: opts.jobId,
    projectId: opts.projectId,
    bundleBytes,
    zipBytes: zip.byteLength,
    loadedMs: smoke.loadedMs,
  });
  return { zip, bundleBytes, zipBytes: zip.byteLength, smoke };
}

function mib(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
