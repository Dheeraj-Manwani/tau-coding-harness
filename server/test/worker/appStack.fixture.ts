import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Sandbox } from "e2b";

// Growing a generation-2 app's stack in place (lib/appStack.ts), against a fake
// sandbox. What is being pinned down is the part that is easy to get wrong and
// expensive when it is: these steps run inside a live project, so they must be
// idempotent, must never overwrite a file the agent has written, and must
// leave the project's `templateKey` describing what the app actually has.
//
// Module mocks are process-global in Bun, and this one replaces `@/lib/prisma`
// and the server-restart helper — hence the child runner (appStack.test.ts),
// same as the other `.fixture.ts` suites.

const APP = "/home/user/app";

let project: { templateKey: string } | null;
let manifest: Map<string, string>;
let restarts: number;
let serverHealthy: boolean;

mock.module("@/lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: async () => project,
      update: async ({ data }: { data: { templateKey: string } }) => {
        if (project) Object.assign(project, data);
        return project;
      },
    },
  },
}));

mock.module("@/worker/lib/aiEnv", () => ({
  restartAppServer: async () => {
    restarts++;
    return serverHealthy;
  },
}));

const realUtils = await import("@/worker/agent/tools/functions/utils");
mock.module("@/worker/agent/tools/functions/utils", () => ({
  ...realUtils,
  persistFile: async (
    _jobId: string,
    _projectId: string,
    _userId: string,
    path: string,
    content: string,
  ) => {
    manifest.set(path, content);
    return { persisted: true };
  },
}));

const { addBackend, addDatabase, ensureAppServer, hasDependency } = await import(
  "@/worker/lib/appStack"
);
const {
  DB_CLIENT_TS,
  HONO_DB_SERVER_INDEX,
  HONO_SERVER_INDEX,
  writeViteConfigContent,
} = await import("@/worker/templates/shared");

interface Fake {
  sandbox: Sandbox;
  files: Record<string, string>;
  commands: string[];
  /** Whether `pgrep` finds a running server. */
  serverUp: boolean;
  failInstall: boolean;
}

/** A sandbox that is a dictionary of files plus just enough of a shell. */
function fakeSandbox(seed: Record<string, string> = {}): Fake {
  const fake: Fake = {
    files: {
      [`${APP}/package.json`]: JSON.stringify({ dependencies: { react: "^19" } }),
      [`${APP}/vite.config.ts`]: writeViteConfigContent({ proxyApi: true }),
      [`${APP}/.gitignore`]: "node_modules\n.env\n",
      ...Object.fromEntries(
        Object.entries(seed).map(([rel, content]) => [`${APP}/${rel}`, content]),
      ),
    },
    commands: [],
    serverUp: false,
    failInstall: false,
    sandbox: null as unknown as Sandbox,
  };

  fake.sandbox = {
    files: {
      read: async (path: string) => {
        const content = fake.files[path];
        if (content === undefined) throw new Error(`not found: ${path}`);
        return content;
      },
      write: async (path: string, content: string) => {
        fake.files[path] = content;
      },
    },
    commands: {
      run: async (cmd: string) => {
        fake.commands.push(cmd);
        if (cmd.startsWith("bun add ")) {
          if (fake.failInstall) throw new Error("registry unreachable");
          const pkg = JSON.parse(fake.files[`${APP}/package.json`]!) as {
            dependencies: Record<string, string>;
          };
          for (const spec of cmd.slice("bun add ".length).split(/\s+/)) {
            // `hono@^4` → hono; `@electric-sql/pglite` stays whole.
            const at = spec.lastIndexOf("@");
            pkg.dependencies[at > 0 ? spec.slice(0, at) : spec] = "*";
          }
          fake.files[`${APP}/package.json`] = JSON.stringify(pkg);
          fake.files[`${APP}/bun.lock`] = `lock:${Object.keys(pkg.dependencies).join(",")}`;
        }
        const stdout = cmd.startsWith("pgrep") ? (fake.serverUp ? "up\n" : "down\n") : "";
        return { exitCode: 0, stdout, stderr: "" };
      },
    },
  } as unknown as Sandbox;

  return fake;
}

const ctx = (fake: Fake) => ({
  sandbox: fake.sandbox,
  projectId: "proj-1",
  userId: "user-1",
  jobId: "job-1",
  indexer: () => 0,
});

const installs = (fake: Fake) => fake.commands.filter((c) => c.startsWith("bun add "));

beforeEach(() => {
  project = { templateKey: "v2-frontend" };
  manifest = new Map();
  restarts = 0;
  serverHealthy = true;
});

describe("addBackend", () => {
  test("sets up a frontend-only app: dependency, server file, process, level", async () => {
    const fake = fakeSandbox();
    const result = await addBackend(ctx(fake));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.alreadySetUp).toBe(false);
    expect(result.changed).toEqual(["package.json", "server/index.ts"]);
    expect(result.serverRunning).toBe(true);
    expect(result.notes).toEqual([]);

    expect(installs(fake)).toEqual(["bun add hono@^4"]);
    expect(fake.files[`${APP}/server/index.ts`]).toBe(HONO_SERVER_INDEX);
    expect(restarts).toBe(1);
    expect(project?.templateKey).toBe("v2-fullstack");
  });

  test("saves what `bun add` changed, so the next sandbox has the dependency", async () => {
    // `bun add` rewrites package.json and the lockfile behind the manifest's
    // back. If they are not copied into it, the next rehydration writes the
    // old package.json and the server it boots cannot import hono.
    const fake = fakeSandbox();
    await addBackend(ctx(fake));

    expect(hasDependency(manifest.get("package.json") ?? null, "hono")).toBe(true);
    expect(manifest.get("bun.lock")).toContain("hono");
    expect(manifest.get("server/index.ts")).toBe(HONO_SERVER_INDEX);
  });

  test("is idempotent: a second call changes nothing and restarts nothing", async () => {
    const fake = fakeSandbox();
    await addBackend(ctx(fake));
    fake.serverUp = true;
    const before = { ...fake.files };
    restarts = 0;

    const again = await addBackend(ctx(fake));

    expect(again.ok && again.alreadySetUp).toBe(true);
    expect(again.ok && again.changed).toEqual([]);
    expect(installs(fake)).toHaveLength(1);
    expect(fake.files).toEqual(before);
    expect(restarts).toBe(0);
    expect(project?.templateKey).toBe("v2-fullstack");
  });

  test("adopts a server the agent already wrote instead of overwriting it", async () => {
    const mine = "import { Hono } from 'hono'\n// my own routes\n";
    const fake = fakeSandbox({ "server/index.ts": mine });

    const result = await addBackend(ctx(fake));

    expect(result.ok).toBe(true);
    expect(fake.files[`${APP}/server/index.ts`]).toBe(mine);
    expect(result.ok && result.changed).toEqual(["package.json"]);
    expect(project?.templateKey).toBe("v2-fullstack");
  });

  test("puts the /api proxy back when the agent's vite config dropped it", async () => {
    const fake = fakeSandbox({
      "vite.config.ts": writeViteConfigContent({ proxyApi: false }),
    });

    const result = await addBackend(ctx(fake));

    expect(result.ok && result.changed).toContain("vite.config.ts");
    expect(fake.files[`${APP}/vite.config.ts`]).toBe(
      writeViteConfigContent({ proxyApi: true }),
    );
  });

  test("says so, rather than guessing, when the vite config is unrecognisable", async () => {
    const custom = "export default { plugins: [] }\n";
    const fake = fakeSandbox({ "vite.config.ts": custom });

    const result = await addBackend(ctx(fake));

    expect(result.ok).toBe(true);
    expect(fake.files[`${APP}/vite.config.ts`]).toBe(custom);
    expect(result.ok && result.notes.join(" ")).toContain("proxy");
  });

  test("reports a server that did not come up", async () => {
    serverHealthy = false;
    const result = await addBackend(ctx(fakeSandbox()));

    expect(result.ok && result.serverRunning).toBe(false);
    expect(result.ok && result.notes.join(" ")).toContain(".tau/logs/server.log");
    // The files are in place, so the level still moves: the app has a server,
    // it is just not healthy.
    expect(project?.templateKey).toBe("v2-fullstack");
  });

  test("leaves the level alone when the install fails", async () => {
    const fake = fakeSandbox();
    fake.failInstall = true;

    const result = await addBackend(ctx(fake));

    expect(result.ok).toBe(false);
    expect(fake.files[`${APP}/server/index.ts`]).toBeUndefined();
    expect(restarts).toBe(0);
    expect(project?.templateKey).toBe("v2-frontend");
  });

  test("start: false leaves the process to the caller", async () => {
    const result = await addBackend(ctx(fakeSandbox()), { start: false });

    expect(result.ok).toBe(true);
    expect(restarts).toBe(0);
    expect(project?.templateKey).toBe("v2-fullstack");
  });

  test("refuses a generation-1 project and touches nothing", async () => {
    project = { templateKey: "frontend" };
    const fake = fakeSandbox();

    const result = await addBackend(ctx(fake));

    expect(result.ok).toBe(false);
    expect(fake.commands).toEqual([]);
    expect(manifest.size).toBe(0);
    expect(project?.templateKey).toBe("frontend");
  });
});

describe("addDatabase", () => {
  test("from a frontend-only app: backend and database in one call, one restart", async () => {
    const fake = fakeSandbox();
    const result = await addDatabase(ctx(fake));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.backendAdded).toBe(true);
    expect(result.alreadySetUp).toBe(false);
    expect(result.notes).toEqual([]);

    expect(installs(fake)).toEqual([
      "bun add hono@^4",
      "bun add drizzle-orm @electric-sql/pglite drizzle-zod @hono/zod-validator",
    ]);
    expect(fake.files[`${APP}/server/db/client.ts`]).toBe(DB_CLIENT_TS);
    expect(fake.files[`${APP}/server/db/schema.ts`]).toBeDefined();
    expect(fake.files[`${APP}/server/db/validation.ts`]).toBeDefined();
    // The untouched scaffold is swapped for the database-wired one.
    expect(fake.files[`${APP}/server/index.ts`]).toBe(HONO_DB_SERVER_INDEX);
    expect(fake.files[`${APP}/.gitignore`]).toContain("\ndata/\n");
    expect(restarts).toBe(1);
    expect(project?.templateKey).toBe("v2-fullstack-db");
  });

  test("on an app that already has a backend, it is not reported as added", async () => {
    project = { templateKey: "v2-fullstack" };
    const fake = fakeSandbox({
      "package.json": JSON.stringify({ dependencies: { hono: "^4" } }),
      "server/index.ts": HONO_SERVER_INDEX,
    });

    const result = await addDatabase(ctx(fake));

    expect(result.ok && result.backendAdded).toBe(false);
    expect(installs(fake)).toHaveLength(1);
    expect(project?.templateKey).toBe("v2-fullstack-db");
  });

  test("never rewrites a server file the agent has edited — hands back the wiring", async () => {
    project = { templateKey: "v2-fullstack" };
    const edited = `${HONO_SERVER_INDEX}\n// app.get('/api/mine', …)\n`;
    const fake = fakeSandbox({
      "package.json": JSON.stringify({ dependencies: { hono: "^4" } }),
      "server/index.ts": edited,
    });

    const result = await addDatabase(ctx(fake));

    expect(result.ok).toBe(true);
    expect(fake.files[`${APP}/server/index.ts`]).toBe(edited);
    expect(result.ok && result.notes.join(" ")).toContain("await initDb()");
    // The database files themselves are still written around it.
    expect(fake.files[`${APP}/server/db/client.ts`]).toBe(DB_CLIENT_TS);
  });

  test("keeps tables the agent has already defined", async () => {
    const mySchema = "export const bookings = pgTable('bookings', {})\n";
    const fake = fakeSandbox({ "server/db/schema.ts": mySchema });

    await addDatabase(ctx(fake));

    expect(fake.files[`${APP}/server/db/schema.ts`]).toBe(mySchema);
  });

  test("is idempotent: a second call changes nothing", async () => {
    const fake = fakeSandbox();
    await addDatabase(ctx(fake));
    fake.serverUp = true;
    const before = { ...fake.files };
    restarts = 0;

    const again = await addDatabase(ctx(fake));

    expect(again.ok && again.alreadySetUp).toBe(true);
    expect(again.ok && again.changed).toEqual([]);
    expect(fake.files).toEqual(before);
    expect(installs(fake)).toHaveLength(2);
    expect(restarts).toBe(0);
    // In particular: `data/` is not appended to .gitignore a second time.
    expect(fake.files[`${APP}/.gitignore`]!.match(/^data\/$/gm)).toHaveLength(1);
  });

  test("refuses a generation-1 project", async () => {
    project = { templateKey: "fullstack" };
    const fake = fakeSandbox();

    const result = await addDatabase(ctx(fake));

    expect(result.ok).toBe(false);
    expect(fake.commands).toEqual([]);
    expect(project?.templateKey).toBe("fullstack");
  });
});

describe("ensureAppServer", () => {
  test("leaves a running server alone", async () => {
    const fake = fakeSandbox();
    fake.serverUp = true;

    expect(await ensureAppServer(fake.sandbox, "job-1")).toBe(true);
    expect(restarts).toBe(0);
  });

  test("starts one that is not running", async () => {
    const fake = fakeSandbox();

    expect(await ensureAppServer(fake.sandbox, "job-1")).toBe(true);
    expect(restarts).toBe(1);
  });
});

describe("hasDependency", () => {
  test("finds a package in either dependency list", () => {
    const pkg = JSON.stringify({
      dependencies: { hono: "^4" },
      devDependencies: { vite: "^8" },
    });
    expect(hasDependency(pkg, "hono")).toBe(true);
    expect(hasDependency(pkg, "vite")).toBe(true);
    expect(hasDependency(pkg, "drizzle-orm")).toBe(false);
  });

  test("treats a missing or unparseable package.json as having nothing", () => {
    expect(hasDependency(null, "hono")).toBe(false);
    expect(hasDependency("{ not json", "hono")).toBe(false);
  });
});
