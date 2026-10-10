import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Sandbox } from "e2b";

// `enable_storage` and the storage half of `buildProjectEnv`, against a fake
// sandbox and an in-memory project. Module mocks are process-global in Bun, so
// this runs in a child (enableStorage.test.ts), like the other fixtures.

const APP = "/home/user/app";
const SECRET = "tau_st_SECRETSECRETSECRETSECRETSECRETSECRET1234";
const LIVE_SECRET = "tau_st_LIVELIVELIVELIVELIVELIVELIVELIVE5678";

const realEnv = (await import("@/lib/env")).env;
const env: Record<string, unknown> = {
  ...realEnv,
  R2_STORAGE_BUCKET: "tau-app-storage",
  TAU_STORAGE_URL: "https://api.tau.example.com/storage/",
  TAU_AI_URL: "https://api.tau.example.com/ai",
  TAU_API_URL: "https://api.tau.example.com/v1",
  TAU_GATEWAY_ALLOW_UNREACHABLE: false,
};
mock.module("@/lib/env", () => ({ env }));

let project: { templateKey: string; storageEnabled: boolean; aiEnabled: boolean; userId?: string; liveDeploymentId?: string } | null;
let manifest: Map<string, string>;
let user: { emailVerifiedAt: Date | null };
let keysMinted: { projectId: string; env: string }[];
let restarts: number;

mock.module("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: async () => user },
    projectSecret: { findMany: async () => [] },
    deployment: {
      findUnique: async () => ({ id: "dep1", backendUrl: "https://fn.example", schemaSql: null, status: "READY" }),
      count: async () => 0,
    },
    project: {
      findUnique: async () => project,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        if (project) Object.assign(project, data);
        return project;
      },
    },
  },
}));
const realApiKeys = await import("@/lib/apiKeys");
mock.module("@/lib/apiKeys", () => ({
  ...realApiKeys,
  keyEncryptionConfigured: () => encryptionOn,
  ensureApiKey: async () => ({ key: "tau_sk_live_AIKEYAIKEYAIKEYAIKEY" }),
}));
mock.module("@/lib/storageKeys", () => ({
  ensureStorageKey: async (projectId: string, _u: string, target: string) => {
    keysMinted.push({ projectId, env: target });
    return { key: target === "LIVE" ? LIVE_SECRET : SECRET };
  },
}));
const realSecrets = await import("@/lib/projectSecrets");
mock.module("@/lib/projectSecrets", () => ({
  ...realSecrets,
  projectSecretEnv: async () => ({ STRIPE_KEY: "sk_user" }),
  hasProjectSecrets: async () => false,
  renderDotenv: (vars: Record<string, string>) => Object.entries(vars).map(([k, v]) => `${k}=${v}`).join("\n"),
}));
let encryptionOn = true;

const refreshed: { projectId: string; deploymentId: string; env: Record<string, string> }[] = [];
const realLambda = await import("@/lib/lambdaApps");
mock.module("@/lib/lambdaApps", () => ({
  ...realLambda,
  backendHostingAvailable: () => true,
  refreshBackendEnv: async (a: { projectId: string; deploymentId: string; env: Record<string, string> }) => {
    refreshed.push(a);
  },
}));

const realUtils = await import("@/worker/agent/tools/functions/utils");
mock.module("@/worker/agent/tools/functions/utils", () => ({
  ...realUtils,
  persistFile: async (_j: string, _p: string, _u: string, path: string, content: string) => {
    manifest.set(path, content);
    return { persisted: true };
  },
}));

const realAiEnv = await import("@/worker/lib/aiEnv");
mock.module("@/worker/lib/aiEnv", () => ({
  ...realAiEnv,
  restartAppServer: async () => {
    restarts++;
    return true;
  },
}));

const { enableStorage } = await import("@/worker/agent/tools/functions/enable-storage");
const { buildPublishEnv } = await import("@/worker/lib/deployFullstack");
const { refreshLiveBackend } = await import("@/lib/refreshSecrets");
const { upsertDeployManifest, AI_ENV_ENTRIES } = await import("@/worker/lib/deployManifest");
const { buildProjectEnv, checkStorageReachability } = await import("@/worker/lib/aiEnv");
const { STORAGE_SCAFFOLD } = await import("@/worker/lib/storageScaffold");

function fakeSandbox(seed: Record<string, string> = {}) {
  const files: Record<string, string> = {
    [`${APP}/package.json`]: JSON.stringify({ dependencies: { react: "^19", hono: "^4" } }),
    [`${APP}/vite.config.ts`]: "export default {}",
    ...Object.fromEntries(Object.entries(seed).map(([rel, c]) => [`${APP}/${rel}`, c])),
  };
  const sandbox = {
    files: {
      read: async (path: string) => {
        if (files[path] === undefined) throw new Error(`not found: ${path}`);
        return files[path];
      },
      write: async (path: string, content: string) => {
        files[path] = content;
      },
    },
    commands: { run: async () => ({ exitCode: 0, stdout: "", stderr: "" }) },
  } as unknown as Sandbox;
  return { sandbox, files };
}

const run = (sandbox: Sandbox) => enableStorage({ purpose: "recipe photos" }, sandbox, "job", "proj", "user", () => 0);

beforeEach(() => {
  project = { templateKey: "v2-fullstack", storageEnabled: false, aiEnabled: false };
  manifest = new Map();
  user = { emailVerifiedAt: new Date() };
  keysMinted = [];
  restarts = 0;
  encryptionOn = true;
  env.R2_STORAGE_BUCKET = "tau-app-storage";
  env.TAU_STORAGE_URL = "https://api.tau.example.com/storage/";
});

describe("enable_storage", () => {
  test("turns storage on, writes .env, the manifest and both helpers, and returns the guide", async () => {
    const { sandbox, files } = fakeSandbox();
    const result = (await run(sandbox)) as Record<string, any>;

    expect(result.success).toBe(true);
    expect(result.helpers).toEqual(["server/storage.ts", "src/lib/uploadFile.ts"]);
    expect(result.recipe).toStartWith("[tau guide: storage]");
    expect(project!.storageEnabled).toBe(true);
    expect(keysMinted[0]).toEqual({ projectId: "proj", env: "PREVIEW" });
    expect(restarts).toBe(1);

    const dotenv = files[`${APP}/.env`]!;
    expect(dotenv).toContain(`TAU_STORAGE_KEY=${SECRET}`);
    expect(dotenv).toContain("TAU_STORAGE_URL=https://api.tau.example.com/storage"); // trailing slash trimmed
    expect(dotenv).toContain("STRIPE_KEY=sk_user"); // the user's own keys survive the rewrite

    for (const f of STORAGE_SCAFFOLD) {
      expect(files[`${APP}/${f.path}`]).toBe(f.content());
      expect(manifest.get(f.path)).toBe(f.content());
    }
    expect(manifest.get(".tau/deploy.json")).toContain("TAU_STORAGE_KEY");
  });

  test("never returns the key's value, and the .env is not persisted", async () => {
    const { sandbox } = fakeSandbox();
    const result = await run(sandbox);
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect([...manifest.keys()]).not.toContain(".env");
    expect(JSON.stringify([...manifest.values()])).not.toContain(SECRET);
  });

  test("adds a backend first when the app has none, without a rebuild", async () => {
    project!.templateKey = "v2-frontend";
    const { sandbox, files } = fakeSandbox();
    const result = (await run(sandbox)) as Record<string, any>;
    expect(result.success).toBe(true);
    expect(result.backendAdded).toContain("server/index.ts");
    expect(files[`${APP}/server/index.ts`]).toBeDefined();
    expect(result.needsReprovision).toBeUndefined();
  });

  test("is idempotent and leaves an edited helper alone", async () => {
    const { sandbox, files } = fakeSandbox();
    await run(sandbox);
    files[`${APP}/server/storage.ts`] = "// the agent changed this\n";
    const again = (await run(sandbox)) as Record<string, any>;
    expect(again.success).toBe(true);
    expect(files[`${APP}/server/storage.ts`]).toBe("// the agent changed this\n");
    expect(restarts).toBe(2);
  });

  test("refuses plainly, writing nothing, when storage is not configured or reachable", async () => {
    const cases: [string, () => void][] = [
      ["no bucket", () => { env.R2_STORAGE_BUCKET = undefined; }],
      ["no address", () => { env.TAU_STORAGE_URL = undefined; }],
      ["loopback address", () => { env.TAU_STORAGE_URL = "http://localhost:8080/storage"; }],
      ["no key encryption", () => { encryptionOn = false; }],
    ];
    for (const [, arrange] of cases) {
      beforeEachReset();
      arrange();
      const { sandbox, files } = fakeSandbox();
      const result = (await run(sandbox)) as Record<string, any>;
      expect(result.error).toContain("not available");
      expect(result.error).toContain("base64");
      expect(files[`${APP}/.env`]).toBeUndefined();
      expect(keysMinted).toHaveLength(0);
      expect(project!.storageEnabled).toBe(false);
    }
  });

  test("an account that has not verified its email is refused and nothing is written", async () => {
    user = { emailVerifiedAt: null };
    const { sandbox, files } = fakeSandbox();
    const result = (await run(sandbox)) as Record<string, any>;
    expect(result.error).toContain("verified email");
    expect(result.error).toContain("base64");
    expect(files[`${APP}/.env`]).toBeUndefined();
    expect(keysMinted).toHaveLength(0);
    expect(project!.storageEnabled).toBe(false);
  });

  test("refuses a generation-1 project", async () => {
    project!.templateKey = "frontend";
    const { sandbox } = fakeSandbox();
    expect(((await run(sandbox)) as Record<string, any>).error).toContain("cannot be added");
  });
});

function beforeEachReset() {
  keysMinted = [];
  env.R2_STORAGE_BUCKET = "tau-app-storage";
  env.TAU_STORAGE_URL = "https://api.tau.example.com/storage/";
  encryptionOn = true;
}

describe("the deploy manifest has two writers", () => {
  test("storage entries keep the AI ones, and the reverse", async () => {
    const { sandbox, files } = fakeSandbox();
    await upsertDeployManifest(sandbox, "j", "p", "u", () => 0, AI_ENV_ENTRIES);
    await run(sandbox);
    const keys = (JSON.parse(files[`${APP}/.tau/deploy.json`]!).envRequired as { key: string }[]).map((e) => e.key);
    expect(keys).toEqual(["TAU_API_KEY", "TAU_AI_URL", "TAU_API_URL", "TAU_STORAGE_KEY", "TAU_STORAGE_URL"]);

    await upsertDeployManifest(sandbox, "j", "p", "u", () => 0, AI_ENV_ENTRIES);
    const again = (JSON.parse(files[`${APP}/.tau/deploy.json`]!).envRequired as { key: string }[]).map((e) => e.key);
    expect(again.sort()).toEqual([...keys].sort());
  });

  test("an entry the agent added is kept", async () => {
    const { sandbox, files } = fakeSandbox({
      ".tau/deploy.json": JSON.stringify({ envRequired: [{ key: "MAPS_KEY", description: "maps" }], other: 1 }),
    });
    await run(sandbox);
    const m = JSON.parse(files[`${APP}/.tau/deploy.json`]!);
    expect(m.other).toBe(1);
    expect(m.envRequired.map((e: { key: string }) => e.key)).toEqual(["MAPS_KEY", "TAU_STORAGE_KEY", "TAU_STORAGE_URL"]);
  });
});

describe("buildProjectEnv", () => {
  test("storage on, AI off", async () => {
    const vars = await buildProjectEnv("u", "p", "j", { aiEnabled: false, storage: "PREVIEW" });
    expect(Object.keys(vars).sort()).toEqual(["STRIPE_KEY", "TAU_STORAGE_KEY", "TAU_STORAGE_URL"]);
  });

  test("both on", async () => {
    const vars = await buildProjectEnv("u", "p", "j", { aiEnabled: true, storage: "PREVIEW" });
    expect(vars.TAU_API_KEY).toBeDefined();
    expect(vars.TAU_STORAGE_KEY).toBe(SECRET);
  });

  test("storage off by default: a publish does not get the preview key", async () => {
    const vars = await buildProjectEnv("u", "p", "j", { aiEnabled: true });
    expect(vars.TAU_STORAGE_KEY).toBeUndefined();
    expect(keysMinted).toHaveLength(0);
  });

  test("an unreachable storage address is skipped and the user's own keys still arrive", async () => {
    env.TAU_STORAGE_URL = "http://10.0.0.5/storage";
    const vars = await buildProjectEnv("u", "p", "j", { aiEnabled: true, storage: "PREVIEW" });
    expect(vars.STRIPE_KEY).toBe("sk_user");
    expect(vars.TAU_API_KEY).toBeDefined();
    expect(vars.TAU_STORAGE_KEY).toBeUndefined();
  });
});

describe("checkStorageReachability", () => {
  const ok = "https://api.tau.example.com/storage";
  test("accepts a public origin and trims the slash", () => {
    expect(checkStorageReachability({ url: ok + "/" })).toEqual({ ok: true, storageUrl: ok });
  });
  test("names why it refuses", () => {
    const why = (o: { configured?: boolean; url?: string }) => {
      const v = checkStorageReachability(o);
      return v.ok ? "ok" : v.reason;
    };
    expect(why({ configured: false, url: ok })).toBe("unconfigured");
    expect(why({})).toBe("unset");
    expect(why({ url: "http://localhost:8080/storage" })).toBe("loopback");
    expect(why({ url: "http://127.0.0.1/storage" })).toBe("loopback");
    expect(why({ url: "http://192.168.1.4/storage" })).toBe("private");
    expect(why({ url: "https://10.example.com/storage" })).toBe("ok"); // a hostname, not an address
  });
});

describe("the published app gets the live key", () => {
  const publish = (storageEnabled: boolean) => buildPublishEnv({ userId: "u", projectId: "p", jobId: "j", aiEnabled: false, storageEnabled });

  test("buildProjectEnv returns a different key for each target, and never the preview key for live", async () => {
    const preview = await buildProjectEnv("u", "p", "j", { aiEnabled: false, storage: "PREVIEW" });
    const live = await buildProjectEnv("u", "p", "j", { aiEnabled: false, storage: "LIVE" });
    expect(preview.TAU_STORAGE_KEY).toBe(SECRET);
    expect(live.TAU_STORAGE_KEY).toBe(LIVE_SECRET);
    expect(JSON.stringify(live)).not.toContain(SECRET);
    expect(live.TAU_STORAGE_URL).toBe(preview.TAU_STORAGE_URL);
  });

  test("a publish carries the live key and production mode, and fits the function environment", async () => {
    const out = await publish(true);
    expect(out.vars.TAU_STORAGE_KEY).toBe(LIVE_SECRET);
    expect(out.vars.TAU_STORAGE_URL).toBe("https://api.tau.example.com/storage");
    expect(out.vars.NODE_ENV).toBe("production");
    expect(JSON.stringify(out.vars)).not.toContain(SECRET);
    expect(keysMinted.at(-1)).toEqual({ projectId: "p", env: "LIVE" });
    const bytes = Object.entries(out.vars).reduce((n, [k, v]) => n + k.length + Buffer.byteLength(v), 0);
    expect(bytes).toBeLessThan(1000);
  });

  test("an app without storage gets no storage variables and no key is minted", async () => {
    keysMinted = [];
    const out = await publish(false);
    expect(out.vars.TAU_STORAGE_KEY).toBeUndefined();
    expect(keysMinted).toHaveLength(0);
  });

  test("a publish refuses, rather than going live without storage, when storage cannot be reached", async () => {
    env.TAU_STORAGE_URL = "http://localhost:8080/storage";
    await expect(publish(true)).rejects.toThrow("File storage is not available");
  });

  test("refreshing secrets re-injects the live storage key, so a rotated key reaches the running app", async () => {
    refreshed.length = 0;
    project = { templateKey: "v2-fullstack", storageEnabled: true, aiEnabled: false, userId: "u", liveDeploymentId: "dep1" };
    const out = await refreshLiveBackend("p");
    expect(out.status).toBe("refreshed");
    expect(refreshed).toHaveLength(1);
    expect(refreshed[0]!.env.TAU_STORAGE_KEY).toBe(LIVE_SECRET);
    expect(refreshed[0]!.env.NODE_ENV).toBe("production");
    expect(JSON.stringify(refreshed[0]!.env)).not.toContain(SECRET);
  });

  test("refreshing an app without storage adds none", async () => {
    refreshed.length = 0;
    project = { templateKey: "v2-fullstack", storageEnabled: false, aiEnabled: false, userId: "u", liveDeploymentId: "dep1" };
    await refreshLiveBackend("p");
    expect(refreshed[0]!.env.TAU_STORAGE_KEY).toBeUndefined();
  });
});
