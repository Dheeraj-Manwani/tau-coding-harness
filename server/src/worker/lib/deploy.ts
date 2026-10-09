/**
 * Build a project's static output inside its sandbox and copy it to R2.
 *
 * The job that drives this is in `worker/index.ts`; everything here is the
 * mechanical half — run a build, find what it produced, upload it — kept
 * separate so the sandbox/R2 work is testable and readable on its own.
 *
 * Invariant worth stating once: a deployment writes only to its own prefix and
 * the project's live pointer is moved after the last byte lands. Nothing here
 * can make a currently-serving site inconsistent, however it fails.
 */
import { env } from "@/lib/env";
import { putSiteObject } from "@/lib/s3";
import {
  cacheControlFor,
  contentTypeFor,
  siteObjectKey,
} from "@/lib/sites";
import { log } from "./log";
import { WORK_DIR, type Sandbox } from "./sandbox";

/** Where the common toolchains put a production build, best guess first. */
const OUTPUT_CANDIDATES = ["dist", "build", "out"] as const;

/** Kept out of the upload entirely — a build that emits these is misconfigured. */
const EXCLUDED_SEGMENTS = new Set(["node_modules", ".git", ".env"]);

const UPLOAD_BATCH = 8;

/** How much build output we keep on the row. Enough to see the error, not a log store. */
const BUILD_LOG_TAIL = 4_000;

export class DeployError extends Error {
  constructor(
    message: string,
    /** Build output to show the user, already tail-trimmed. */
    readonly buildLog?: string,
  ) {
    super(message);
    this.name = "DeployError";
  }
}

/** Which half of the publish is running, plus a line for the user. */
export interface DeployProgress {
  phase: "building" | "uploading";
  message: string;
}

export interface BuildOutcome {
  outputDir: string;
  fileCount: number;
  sizeBytes: number;
  /** Set when the build only passed because the type-check gate was bypassed. */
  warning?: string;
  buildLog: string;
}

/** Colour codes: the build tools write as if to a terminal. */
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

/**
 * The end of a build's output, as plain text. Colours go first, before the
 * cut: a bundler colours a code frame one token at a time, so left in they are
 * most of the characters and push the error itself out of the part we keep.
 */
function tail(output: string): string {
  const text = output.replace(ANSI, "");
  return text.length <= BUILD_LOG_TAIL
    ? text
    : `…\n${text.slice(-BUILD_LOG_TAIL)}`;
}

interface CommandResult {
  exitCode: number;
  output: string;
}

async function run(
  sandbox: Sandbox,
  command: string,
  timeoutMs: number,
): Promise<CommandResult> {
  try {
    const res = await sandbox.commands.run(command, {
      cwd: WORK_DIR,
      timeoutMs,
    });
    return {
      exitCode: res.exitCode ?? 0,
      output: `${res.stdout ?? ""}${res.stderr ?? ""}`,
    };
  } catch (err) {
    // e2b throws on a non-zero exit and carries the streams on the error. Read
    // them off rather than losing the only explanation of why a build failed.
    const e = err as { exitCode?: number; stdout?: string; stderr?: string };
    if (typeof e?.exitCode === "number" || e?.stderr !== undefined) {
      return {
        exitCode: e.exitCode ?? 1,
        output: `${e.stdout ?? ""}${e.stderr ?? ""}` || String(err),
      };
    }
    throw err;
  }
}

/** Does the project define its own build script? */
async function hasBuildScript(sandbox: Sandbox): Promise<boolean> {
  try {
    const raw = await sandbox.files.read(`${WORK_DIR}/package.json`);
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
    return typeof pkg.scripts?.build === "string" && pkg.scripts.build !== "";
  } catch {
    return false;
  }
}

/**
 * Run the project's build.
 *
 * The templates scaffold `"build": "tsc -b && vite build"`, so a single unused
 * variable fails the build even though the app runs perfectly. That is the right
 * default for a developer and the wrong one for someone publishing an app an
 * agent wrote for them, so a failed build gets one retry with `vite build`
 * alone: esbuild strips types anyway, meaning a type error never changed the
 * bundle it would have produced. When that retry is what succeeded we say so —
 * publishing quietly past a red type-check would be the actually dishonest
 * version of this.
 */
async function runBuild(
  sandbox: Sandbox,
  jobId: string,
  projectId: string,
): Promise<{ log: string; warning?: string }> {
  const timeoutMs = env.DEPLOY_BUILD_TIMEOUT_MS;

  if (!(await hasBuildScript(sandbox))) {
    throw new DeployError(
      "This project has no build script, so there is nothing to publish yet.",
    );
  }

  const first = await run(sandbox, "bun run build", timeoutMs);
  if (first.exitCode === 0) return { log: tail(first.output) };

  log.warn("deploy.build.failed", {
    jobId,
    projectId,
    exitCode: first.exitCode,
  });

  const retry = await run(sandbox, "bunx vite build", timeoutMs);
  if (retry.exitCode !== 0) {
    throw new DeployError(
      "The build failed. Ask the agent to fix the errors, then publish again.",
      tail(`${first.output}\n${retry.output}`),
    );
  }

  log.info("deploy.build.typecheck_bypassed", { jobId, projectId });
  return {
    log: tail(`${first.output}\n${retry.output}`),
    warning:
      "Published, but the project's type check failed. The app was bundled anyway — the errors are worth fixing.",
  };
}

/** First candidate directory that exists and contains an index.html. */
async function findOutputDir(sandbox: Sandbox): Promise<string> {
  for (const dir of OUTPUT_CANDIDATES) {
    const res = await run(sandbox, `test -f ${dir}/index.html`, 15_000);
    if (res.exitCode === 0) return dir;
  }
  throw new DeployError(
    `The build produced no index.html in ${OUTPUT_CANDIDATES.join(", ")}, so there is no site to serve.`,
  );
}

interface OutputListing {
  /** Paths relative to the output directory, e.g. "assets/index-a1b2.js". */
  paths: string[];
  /**
   * Total size, or null when `find` could not report sizes. Null moves the byte
   * cap from a pre-flight check to a running total during upload — see
   * {@link buildAndUpload}.
   */
  sizeBytes: number | null;
}

function keep(path: string): boolean {
  return (
    path.length > 0 && !path.split("/").some((s) => EXCLUDED_SEGMENTS.has(s))
  );
}

/**
 * Every file in the output directory, with sizes when they can be had cheaply.
 *
 * `-printf` is GNU findutils, which the bun base image has — and getting sizes
 * from `find` is what lets the byte cap be checked *before* anything is read
 * into this process, which is most of the point of having a cap. But a template
 * could be rebuilt on a BusyBox image tomorrow, and a publish failing with
 * "find: unrecognized option" would be a baffling way to discover that. So the
 * portable `find -type f` is the fallback, and the caller accounts for size as
 * it uploads instead.
 */
async function listOutputFiles(
  sandbox: Sandbox,
  outputDir: string,
): Promise<OutputListing> {
  const withSizes = await run(
    sandbox,
    `find ${outputDir} -type f -printf '%s\\t%P\\n'`,
    60_000,
  );

  if (withSizes.exitCode === 0) {
    const paths: string[] = [];
    let sizeBytes = 0;
    for (const line of withSizes.output.split("\n")) {
      const tabIndex = line.indexOf("\t");
      if (tabIndex <= 0) continue;
      const size = Number(line.slice(0, tabIndex));
      const path = line.slice(tabIndex + 1).trim();
      if (!Number.isFinite(size) || !keep(path)) continue;
      paths.push(path);
      sizeBytes += size;
    }
    return { paths, sizeBytes };
  }

  const plain = await run(sandbox, `find ${outputDir} -type f`, 60_000);
  if (plain.exitCode !== 0) {
    throw new DeployError("Couldn't read the build output.", tail(plain.output));
  }

  const prefix = `${outputDir}/`;
  const paths = plain.output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length))
    .filter(keep);

  return { paths, sizeBytes: null };
}

/**
 * Build the project and copy its static output into `storagePrefix`.
 *
 * Throws {@link DeployError} for anything the user can act on (build failed, no
 * output, too big); anything else is a bug or an outage and propagates.
 */
export async function buildAndUpload(opts: {
  sandbox: Sandbox;
  storagePrefix: string;
  jobId: string;
  projectId: string;
  onProgress?: (update: DeployProgress) => Promise<void> | void;
}): Promise<BuildOutcome> {
  const { sandbox, storagePrefix, jobId, projectId, onProgress } = opts;

  await onProgress?.({ phase: "building", message: "Building your app" });
  const build = await runBuild(sandbox, jobId, projectId);

  const outputDir = await findOutputDir(sandbox);
  const { paths, sizeBytes: knownSize } = await listOutputFiles(
    sandbox,
    outputDir,
  );

  if (paths.length === 0) {
    throw new DeployError("The build produced no files.", build.log);
  }
  if (paths.length > env.DEPLOY_MAX_FILES) {
    throw new DeployError(
      `The build produced ${paths.length} files, over the ${env.DEPLOY_MAX_FILES} limit.`,
      build.log,
    );
  }
  if (knownSize !== null && knownSize > env.DEPLOY_MAX_BYTES) {
    throw new DeployError(
      `The build is ${mib(knownSize)}, over the ${mib(env.DEPLOY_MAX_BYTES)} limit.`,
      build.log,
    );
  }

  await onProgress?.({
    phase: "uploading",
    message: `Uploading ${paths.length} files`,
  });
  log.info("deploy.upload.start", {
    jobId,
    projectId,
    outputDir,
    files: paths.length,
    sizeBytes: knownSize,
  });

  // Always accumulated, so the total on the row is measured rather than
  // reported — and so the cap still holds when `find` could not give us sizes
  // up front. Tripping it mid-upload abandons a partly-written prefix, which is
  // harmless: nothing points at it, and the sweep reclaims it.
  let uploadedBytes = 0;

  for (let i = 0; i < paths.length; i += UPLOAD_BATCH) {
    const batch = await Promise.all(
      paths.slice(i, i + UPLOAD_BATCH).map(async (path) => {
        // Bytes, not text: a font or an image round-tripped through a UTF-8
        // decode comes out corrupt, and a published site is mostly assets.
        //
        // An absolute path, unlike the commands above: those run with
        // `cwd: WORK_DIR`, but the files API has no working directory and
        // resolves a relative path against the sandbox user's home, where
        // there is no `dist/`.
        const bytes = await sandbox.files.read(
          `${WORK_DIR}/${outputDir}/${path}`,
          { format: "bytes" },
        );
        await putSiteObject(
          siteObjectKey(storagePrefix, path),
          bytes,
          contentTypeFor(path),
          cacheControlFor(path),
        );
        return bytes.byteLength;
      }),
    );

    uploadedBytes += batch.reduce((sum, n) => sum + n, 0);
    if (uploadedBytes > env.DEPLOY_MAX_BYTES) {
      throw new DeployError(
        `The build is over the ${mib(env.DEPLOY_MAX_BYTES)} limit.`,
        build.log,
      );
    }
  }

  log.info("deploy.upload.done", {
    jobId,
    projectId,
    files: paths.length,
    sizeBytes: uploadedBytes,
  });

  return {
    outputDir,
    fileCount: paths.length,
    sizeBytes: uploadedBytes,
    warning: build.warning,
    buildLog: build.log,
  };
}

function mib(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
