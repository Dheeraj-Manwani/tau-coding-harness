/**
 * Growing a generation-2 app's stack in place: frontend → + backend → + database.
 *
 * Generation 1 answers "this app needs a server" by moving the project to a
 * different sandbox image: `migrateTemplate` rewrites the manifest, marks the
 * sandbox dead, and the agent has to tell the user their app is rebuilding. It
 * has no answer at all for "this app needs a database" beyond a recipe the
 * model is trusted to follow.
 *
 * Generation 2 has one image (`tau-app-v2`), so neither is a move. The four
 * things that differ between a frontend app and one with a server are all
 * mechanical — a dependency, `server/index.ts`, the `/api` proxy, a running
 * process — and the database is four more files and four more packages. Both
 * are done here, against the live sandbox, in a few seconds:
 *
 *   - the image already carries the `/api` proxy and has the packages in Bun's
 *     install cache, so nothing waits on the network;
 *   - `restartAppServer` starts Hono without touching Vite, so the preview and
 *     its hot-reload connection survive;
 *   - the project's `templateKey` moves up a level (`v2-frontend` →
 *     `v2-fullstack` → `v2-fullstack-db`), which is what the system prompt, the
 *     deploy flow and the next provision read.
 *
 * Every step is idempotent and none of them overwrites the agent's work: a file
 * that already exists is left alone, and where that means something could not
 * be wired automatically the result says so, in `notes`, for the agent to
 * finish by hand.
 *
 * See doc/CONTEXT_AND_MEMORY_PLAN.md §6.
 */
import { CommandExitError, type Sandbox } from "e2b";
import { prisma } from "@/lib/prisma";
import { log } from "./log";
import { restartAppServer } from "./aiEnv";
import { patchViteConfig } from "./migrateTemplate";
import { persistFile, WORK_DIR } from "../agent/tools/functions/utils";
import {
  TEMPLATES,
  toTemplateKey,
  type TemplateEntry,
  type TemplateKey,
} from "../templates/registry";
import {
  BACKEND_PACKAGES,
  DATABASE_PACKAGES,
  DB_CLIENT_TS,
  DB_SCHEMA_TS,
  DB_VALIDATION_TS,
  HONO_DB_SERVER_INDEX,
  HONO_SERVER_INDEX,
} from "../templates/shared";

export interface StackContext {
  sandbox: Sandbox;
  projectId: string;
  userId: string;
  jobId: string;
  indexer: () => number;
}

export type StackResult =
  | {
      ok: true;
      /** Nothing had to change: the app was already at this level. */
      alreadySetUp: boolean;
      /** Project-relative paths written or modified. */
      changed: string[];
      /** Things the agent must know or finish by hand. */
      notes: string[];
      /** Whether `/api/health` answered after the server was (re)started. */
      serverRunning: boolean;
      /** `addDatabase` only: this call is also what created the backend. */
      backendAdded?: boolean;
    }
  | { ok: false; error: string };

const GENERATION_1_ERROR =
  "This project's stack was fixed when it was created, so a backend or database cannot be added to it this way. Use what the project already has, and tell the user plainly if the request needs something it lacks.";

const SERVER_DOWN_NOTE =
  "The server did not answer on /api/health after it was started. Read `.tau/logs/server.log` to find out why before relying on it.";

const PROXY_NOTE =
  "`vite.config.ts` has no `/api` proxy and tau could not add one automatically. Add `proxy: { '/api': 'http://localhost:3000' }` to its `server` block, or the frontend's `/api/*` calls will not reach the server.";

const WIRING_NOTE =
  "`server/index.ts` had already been edited, so tau left it alone. Wire the database in yourself: add `import { db, initDb } from './db/client'` at the top, and `await initDb()` before `const app = new Hono()`.";

const fail = (error: string): StackResult => ({ ok: false, error });

export async function readOrNull(sandbox: Sandbox, rel: string): Promise<string | null> {
  try {
    return await sandbox.files.read(`${WORK_DIR}/${rel}`);
  } catch {
    return null;
  }
}

/** Write a file into the sandbox and the project manifest. */
export async function writeTracked(
  ctx: StackContext,
  rel: string,
  content: string,
): Promise<void> {
  await ctx.sandbox.files.write(`${WORK_DIR}/${rel}`, content);
  await persistFile(ctx.jobId, ctx.projectId, ctx.userId, rel, content, ctx.indexer);
}

/**
 * Copy a file the sandbox changed by itself (`bun add` rewriting package.json
 * and the lockfile) into the manifest. Without this the next sandbox is
 * rehydrated from the old `package.json`, and the app it boots is missing the
 * very dependency this step added.
 */
async function persistFromSandbox(ctx: StackContext, rel: string): Promise<void> {
  const content = await readOrNull(ctx.sandbox, rel);
  if (content === null) return;
  await persistFile(ctx.jobId, ctx.projectId, ctx.userId, rel, content, ctx.indexer);
}

export function hasDependency(packageJson: string | null, name: string): boolean {
  if (!packageJson) return false;
  try {
    const pkg = JSON.parse(packageJson) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return Boolean(pkg.dependencies?.[name] ?? pkg.devDependencies?.[name]);
  } catch {
    return false;
  }
}

export async function bunAdd(
  ctx: StackContext,
  packages: string,
): Promise<{ ok: true } | { ok: false; detail: string }> {
  try {
    await ctx.sandbox.commands.run(`bun add ${packages}`, {
      cwd: WORK_DIR,
      timeoutMs: 3 * 60_000,
    });
  } catch (err) {
    const detail =
      err instanceof CommandExitError
        ? `${err.stderr || err.stdout}`.trim().slice(-600)
        : String(err);
    return { ok: false, detail };
  }
  await persistFromSandbox(ctx, "package.json");
  await persistFromSandbox(ctx, "bun.lock");
  return { ok: true };
}

async function loadEntry(
  projectId: string,
): Promise<{ key: TemplateKey; entry: TemplateEntry } | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { templateKey: true },
  });
  if (!project) return null;
  const key = toTemplateKey(project.templateKey);
  return { key, entry: TEMPLATES[key] };
}

async function setLevel(projectId: string, key: TemplateKey): Promise<void> {
  await prisma.project.update({
    where: { id: projectId },
    data: { templateKey: key },
  });
}

/**
 * Make sure a generation-2 app's server process is up, starting it if not.
 *
 * The image's start command runs Vite only — it cannot know which apps will
 * grow a server — so on this generation the harness owns the process: started
 * when the backend is added, and again here whenever a sandbox is created or
 * reconnected for a project that has one.
 *
 * @returns whether the server is running. Never throws.
 */
export async function ensureAppServer(
  sandbox: Sandbox,
  jobId: string,
): Promise<boolean> {
  try {
    // Same bracket trick as `restartAppServer`: without it the pattern matches
    // the shell running this very command.
    const res = await sandbox.commands.run(
      "pgrep -f '[s]erver/index.ts' >/dev/null && echo up || echo down",
      { cwd: WORK_DIR, timeoutMs: 15_000 },
    );
    if (res.stdout.trim() === "up") return true;
  } catch {
    // Could not tell — starting it is the safe answer.
  }
  return restartAppServer(sandbox, jobId);
}

/**
 * Give a frontend-only app a Hono API.
 *
 * `start: false` skips starting the server, for a caller that is about to
 * restart it anyway (`enable_ai` writes `.env` first; `addDatabase` installs
 * more packages first). `serverRunning` is then reported as false.
 */
export async function addBackend(
  ctx: StackContext,
  opts: { start?: boolean } = {},
): Promise<StackResult> {
  const loaded = await loadEntry(ctx.projectId);
  if (!loaded) return fail(`Project ${ctx.projectId} not found`);
  const { entry } = loaded;
  if (entry.generation !== 2) return fail(GENERATION_1_ERROR);

  const changed: string[] = [];
  const notes: string[] = [];

  // 1) The dependency. Already in Bun's cache on this image, so this links from
  //    disk rather than downloading.
  if (!hasDependency(await readOrNull(ctx.sandbox, "package.json"), "hono")) {
    const added = await bunAdd(ctx, BACKEND_PACKAGES);
    if (!added.ok) {
      return fail(`Could not install the server package (hono): ${added.detail}`);
    }
    changed.push("package.json");
  }

  // 2) The server itself — unless the agent has already written one, in which
  //    case theirs stands and we just adopt it.
  if ((await readOrNull(ctx.sandbox, "server/index.ts")) === null) {
    await writeTracked(ctx, "server/index.ts", HONO_SERVER_INDEX);
    changed.push("server/index.ts");
  }

  // 3) The proxy. The image ships it, so this only acts when the agent has
  //    rewritten `vite.config.ts` and dropped it.
  const vite = await readOrNull(ctx.sandbox, "vite.config.ts");
  const patched = vite === null ? null : patchViteConfig(vite);
  if (patched === null) {
    notes.push(PROXY_NOTE);
  } else if (patched !== vite) {
    await writeTracked(ctx, "vite.config.ts", patched);
    changed.push("vite.config.ts");
  }

  // 4) The process.
  let serverRunning = false;
  if (opts.start !== false) {
    serverRunning =
      changed.length === 0
        ? await ensureAppServer(ctx.sandbox, ctx.jobId)
        : await restartAppServer(ctx.sandbox, ctx.jobId);
    if (!serverRunning) notes.push(SERVER_DOWN_NOTE);
  }

  // 5) The level — last, so a failure above leaves the project describing what
  //    it actually has.
  if (!entry.hasServer) await setLevel(ctx.projectId, "v2-fullstack");

  log.info("stack.backend", {
    jobId: ctx.jobId,
    projectId: ctx.projectId,
    changed,
    notes: notes.length,
    serverRunning,
  });

  return {
    ok: true,
    alreadySetUp: entry.hasServer && changed.length === 0,
    changed,
    notes,
    serverRunning,
  };
}

/**
 * Give an app a PGlite + Drizzle database, adding the backend first if it has
 * none.
 *
 * `server/index.ts` is only replaced when it is still exactly the file
 * `addBackend` wrote — then swapping in the database-wired version loses
 * nothing. Once the agent has edited it, it is theirs: the `server/db/` files
 * are written around it and the two lines that wire them in are handed back as
 * a note.
 */
export async function addDatabase(ctx: StackContext): Promise<StackResult> {
  const loaded = await loadEntry(ctx.projectId);
  if (!loaded) return fail(`Project ${ctx.projectId} not found`);
  const { entry } = loaded;
  if (entry.generation !== 2) return fail(GENERATION_1_ERROR);

  const changed: string[] = [];
  const notes: string[] = [];

  if (!entry.hasServer) {
    const backend = await addBackend(ctx, { start: false });
    if (!backend.ok) return backend;
    changed.push(...backend.changed);
    notes.push(...backend.notes);
  }

  const pkg = await readOrNull(ctx.sandbox, "package.json");
  if (
    !hasDependency(pkg, "drizzle-orm") ||
    !hasDependency(pkg, "@electric-sql/pglite")
  ) {
    const added = await bunAdd(ctx, DATABASE_PACKAGES);
    if (!added.ok) {
      return fail(`Could not install the database packages: ${added.detail}`);
    }
    if (!changed.includes("package.json")) changed.push("package.json");
  }

  // PGlite persists to ./data/pgdata; keep it out of the user's repository.
  const gitignore = (await readOrNull(ctx.sandbox, ".gitignore")) ?? "";
  if (!/^data\/?$/m.test(gitignore)) {
    await writeTracked(ctx, ".gitignore", `${gitignore}\ndata/\n`);
    changed.push(".gitignore");
  }

  for (const [rel, content] of [
    ["server/db/schema.ts", DB_SCHEMA_TS],
    ["server/db/client.ts", DB_CLIENT_TS],
    ["server/db/validation.ts", DB_VALIDATION_TS],
  ] as const) {
    if ((await readOrNull(ctx.sandbox, rel)) === null) {
      await writeTracked(ctx, rel, content);
      changed.push(rel);
    }
  }

  const index = await readOrNull(ctx.sandbox, "server/index.ts");
  if (index === null || index === HONO_SERVER_INDEX) {
    await writeTracked(ctx, "server/index.ts", HONO_DB_SERVER_INDEX);
    if (!changed.includes("server/index.ts")) changed.push("server/index.ts");
  } else if (!index.includes("initDb")) {
    notes.push(WIRING_NOTE);
  }

  // New packages are only visible to a fresh process, so a real restart
  // whenever anything changed.
  const serverRunning =
    changed.length === 0
      ? await ensureAppServer(ctx.sandbox, ctx.jobId)
      : await restartAppServer(ctx.sandbox, ctx.jobId);
  if (!serverRunning) notes.push(SERVER_DOWN_NOTE);

  if (!entry.hasDb) await setLevel(ctx.projectId, "v2-fullstack-db");

  log.info("stack.database", {
    jobId: ctx.jobId,
    projectId: ctx.projectId,
    changed,
    notes: notes.length,
    serverRunning,
  });

  return {
    ok: true,
    alreadySetUp: entry.hasDb && changed.length === 0,
    changed,
    notes,
    serverRunning,
    backendAdded: !entry.hasServer,
  };
}
