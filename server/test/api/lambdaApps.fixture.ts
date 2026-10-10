import { beforeEach, describe, expect, mock, test } from "bun:test";

// The Lambda flow against a stand-in for AWS: what is created in what order,
// that each resource is recorded before it is created, that a publish that died
// half way can start over, and that removal is complete and repeatable. Nothing
// here has run against real AWS; that is Phase 4's proof step.

type Row = Record<string, any>;
const resources: Row[] = [];
const events: string[] = [];

mock.module("@/lib/prisma", () => ({
  prisma: {
    projectResource: {
      upsert: async ({ where, create, update }: { where: any; create: Row; update: Row }) => {
        const { kind, providerId } = where.kind_providerId;
        const found = resources.find((r) => r.kind === kind && r.providerId === providerId);
        events.push(`db:record ${kind}`);
        if (found) Object.assign(found, update);
        else resources.push({ id: `r${resources.length + 1}`, deletedAt: null, ...create });
        return found ?? resources.at(-1);
      },
      findFirst: async ({ where }: { where: Row }) =>
        resources.find((r) => r.projectId === where.projectId && r.kind === where.kind && r.deletedAt === null) ?? null,
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const hit = resources.filter((r) => r.kind === where.kind && r.providerId === where.providerId && r.deletedAt === null);
        for (const r of hit) Object.assign(r, data);
        events.push(`db:deleted ${where.kind}`);
        return { count: hit.length };
      },
    },
  },
}));

const { env } = await import("@/lib/env");
const {
  ENV_LIMIT_BYTES,
  LambdaEnvError,
  aliasName,
  backendHostingAvailable,
  functionName,
  hostingConfig,
  isNotFound,
  isRoleNotReady,
  logGroupName,
  pruneBackend,
  publishBackend,
  refreshBackendEnv,
  removeBackend,
  setLambdaDepsForTests,
  validateLambdaEnv,
} = await import("@/lib/lambdaApps");

// ── The AWS stand-in ─────────────────────────────────────────────────────────

const awsError = (name: string, message = name) => Object.assign(new Error(message), { name });

class FakeAws {
  /** What `recentLogs` returns. */
  logLines: string[] = [];
  roles = new Map<string, string>();
  functions = new Set<string>();
  aliases = new Map<string, { alias: string; version: string }[]>();
  urls = new Set<string>();
  versions = new Map<string, string[]>();
  logGroups = new Set<string>();
  calls: string[] = [];
  failures: Record<string, Error[]> = {};
  sleeps: number[] = [];
  last: { env?: Record<string, string>; settings?: any; zipBytes?: number } = {};

  /** Fail the next calls to `method` with these errors, in order. */
  failNext(method: string, ...errors: Error[]) {
    this.failures[method] = errors;
  }
  private enter(method: string, detail = "") {
    this.calls.push(detail ? `${method} ${detail}` : method);
    events.push(`aws:${method}`);
    const next = this.failures[method]?.shift();
    if (next) throw next;
  }

  api = {
    createRole: async (name: string) => {
      this.enter("createRole", name);
      const arn = `arn:aws:iam::123456789012:role/tau-apps/${name}`;
      this.roles.set(name, arn);
      return { arn, accountId: "123456789012" };
    },
    getRole: async (name: string) => {
      this.enter("getRole", name);
      const arn = this.roles.get(name);
      return arn ? { arn, accountId: "123456789012" } : null;
    },
    putLogsPolicy: async (role: string, group: string) => void this.enter("putLogsPolicy", `${role} ${group}`),
    deleteRolePolicy: async (role: string) => {
      this.enter("deleteRolePolicy", role);
      if (!this.roles.has(role)) throw awsError("NoSuchEntityException");
    },
    deleteRole: async (role: string) => {
      this.enter("deleteRole", role);
      if (!this.roles.delete(role)) throw awsError("NoSuchEntityException");
    },
    createLogGroup: async (name: string, days: number) => {
      this.enter("createLogGroup", `${name} ${days}d`);
      this.logGroups.add(name);
    },
    deleteLogGroup: async (name: string) => {
      this.enter("deleteLogGroup", name);
      if (!this.logGroups.delete(name)) throw awsError("ResourceNotFoundException");
    },
    recentLogs: async (name: string, _since: number, _limit: number) => {
      this.enter("recentLogs", name);
      return this.logLines;
    },
    functionExists: async (name: string) => {
      this.enter("functionExists", name);
      return this.functions.has(name);
    },
    createFunction: async (name: string, zip: Uint8Array, s: any) => {
      this.enter("createFunction", name);
      this.functions.add(name);
      this.versions.set(name, ["1"]);
      this.last = { env: s.env, settings: s, zipBytes: zip.byteLength };
      return { version: "1" };
    },
    updateAlias: async (name: string, alias: string, version: string) => {
      this.enter("updateAlias", `${name} ${alias} ${version}`);
      this.aliases.set(name, (this.aliases.get(name) ?? []).map((a) => (a.alias === alias ? { ...a, version } : a)));
    },
    getVersionCode: async (name: string, version: string) => {
      this.enter("getVersionCode", `${name} ${version}`);
      return new Uint8Array(7);
    },
    updateConfiguration: async (name: string, s: any) => {
      this.enter("updateConfiguration", name);
      this.last = { ...this.last, env: s.env, settings: s };
    },
    updateCode: async (name: string, zip: Uint8Array) => {
      this.enter("updateCode", name);
      const v = String(this.versions.get(name)!.length + 1);
      this.versions.get(name)!.push(v);
      this.last.zipBytes = zip.byteLength;
      return { version: v };
    },
    putConcurrency: async (name: string, n: number) => void this.enter("putConcurrency", `${name} ${n}`),
    createAlias: async (name: string, alias: string, version: string) => {
      this.enter("createAlias", `${alias} -> v${version}`);
      this.aliases.set(name, [...(this.aliases.get(name) ?? []), { alias, version }]);
    },
    createUrl: async (name: string, alias: string) => {
      this.enter("createUrl", alias);
      this.urls.add(`${name}:${alias}`);
      return { url: `https://${alias.slice(0, 8)}.lambda-url.eu-west-1.on.aws` };
    },
    deleteUrl: async (name: string, alias: string) => {
      this.enter("deleteUrl", alias);
      if (!this.urls.delete(`${name}:${alias}`)) throw awsError("ResourceNotFoundException");
    },
    deleteAlias: async (name: string, alias: string) => {
      this.enter("deleteAlias", alias);
      this.aliases.set(name, (this.aliases.get(name) ?? []).filter((a) => a.alias !== alias));
    },
    listAliases: async (name: string) => {
      this.enter("listAliases", name);
      if (!this.functions.has(name)) throw awsError("ResourceNotFoundException");
      return [...(this.aliases.get(name) ?? [])];
    },
    listVersions: async (name: string) => {
      this.enter("listVersions", name);
      return [...(this.versions.get(name) ?? [])];
    },
    deleteVersion: async (name: string, version: string) => {
      this.enter("deleteVersion", `v${version}`);
      this.versions.set(name, (this.versions.get(name) ?? []).filter((v) => v !== version));
    },
    deleteFunction: async (name: string) => {
      this.enter("deleteFunction", name);
      if (!this.functions.delete(name)) throw awsError("ResourceNotFoundException");
    },
  };
}

const CONFIG = {
  region: "eu-west-1",
  accessKeyId: "AKIA",
  secretAccessKey: "secret",
  boundaryArn: "arn:aws:iam::123456789012:policy/tau-apps-boundary",
  reservedConcurrency: 2,
  memoryMb: 512,
  timeoutS: 15,
  logRetentionDays: 14,
};

let aws: FakeAws;
const PROJECT = "11111111-1111-4111-8111-111111111111";
const D1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const D2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const D3 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const zip = new Uint8Array(1234);
const FN = functionName(PROJECT);

const publish = (deploymentId = D1, vars: Record<string, string> = { NODE_ENV: "production" }) =>
  publishBackend({ projectId: PROJECT, deploymentId, zip, env: vars });

beforeEach(() => {
  resources.length = 0;
  events.length = 0;
  aws = new FakeAws();
  setLambdaDepsForTests({
    api: () => ({ api: aws.api as never, config: { ...CONFIG } }),
    sleep: async (ms) => void aws.sleeps.push(ms),
  });
});

describe("names", () => {
  test("everything for a project shares the tau-app- prefix the credentials are scoped to", () => {
    expect(functionName(PROJECT)).toBe(`tau-app-${PROJECT}`);
    expect(logGroupName(PROJECT)).toBe(`/aws/lambda/tau-app-${PROJECT}`);
    expect(aliasName(D1)).toBe(`d-${D1}`);
    // Aliases cannot be only digits; the prefix makes sure of it.
    expect(aliasName("12345")).not.toMatch(/^\d+$/);
    expect(functionName(PROJECT).length).toBeLessThanOrEqual(64);
  });
});

describe("the first publish", () => {
  test("creates the role, the log group, then the function, then an alias and a URL", async () => {
    const out = await publish();

    expect(aws.calls).toEqual([
      `getRole ${FN}`,
      `createRole ${FN}`,
      `createLogGroup ${logGroupName(PROJECT)} 14d`,
      `putLogsPolicy ${FN} arn:aws:logs:eu-west-1:123456789012:log-group:${logGroupName(PROJECT)}`,
      `createFunction ${FN}`,
      `putConcurrency ${FN} 2`,
      `createAlias ${aliasName(D1)} -> v1`,
      `createUrl ${aliasName(D1)}`,
    ]);
    expect(out).toMatchObject({ functionName: FN, version: "1", alias: aliasName(D1) });
    expect(out.url).toStartWith("https://");
    expect(out.url.endsWith("/")).toBe(false);
  });

  // A publish that dies mid-way must leave a record cleanup can follow.
  test("each resource is recorded in the database before AWS is asked to create it", async () => {
    await publish();

    expect(events.indexOf("db:record IAM_ROLE")).toBeLessThan(events.indexOf("aws:createRole"));
    expect(events.indexOf("db:record LAMBDA_FUNCTION")).toBeLessThan(events.indexOf("aws:createFunction"));
    expect(resources.map((r) => [r.kind, r.providerId, r.region])).toEqual([
      ["IAM_ROLE", FN, "eu-west-1"],
      ["LAMBDA_FUNCTION", FN, "eu-west-1"],
    ]);
  });

  test("the function gets the settings, the environment and the zip", async () => {
    await publish(D1, { NODE_ENV: "production", STRIPE_KEY: "sk_x" });

    expect(aws.last.settings).toMatchObject({ memoryMb: 512, timeoutS: 15, env: { NODE_ENV: "production", STRIPE_KEY: "sk_x" } });
    expect(aws.last.settings.roleArn).toBe(`arn:aws:iam::123456789012:role/tau-apps/${FN}`);
    expect(aws.last.zipBytes).toBe(1234);
  });

  test("the log policy covers its own log group and nothing else", async () => {
    await publish();
    const call = aws.calls.find((c) => c.startsWith("putLogsPolicy"))!;
    expect(call).toContain(`log-group:${logGroupName(PROJECT)}`);
    expect(call).not.toContain("*");
  });

  test("a refused concurrency cap is logged and does not fail the publish", async () => {
    aws.failNext("putConcurrency", awsError("InvalidParameterValueException", "unreserved concurrency below minimum"));
    const out = await publish();
    expect(out.version).toBe("1");
    expect(aws.calls.some((c) => c.startsWith("createAlias"))).toBe(true);
  });

  test("with a cap of zero no cap is set", async () => {
    setLambdaDepsForTests({ api: () => ({ api: aws.api as never, config: { ...CONFIG, reservedConcurrency: 0 } }), sleep: async () => {} });
    await publish();
    expect(aws.calls.some((c) => c.startsWith("putConcurrency"))).toBe(false);
  });
});

describe("IAM catching up", () => {
  test("a role Lambda cannot assume yet is retried with a wait, then succeeds", async () => {
    aws.failNext(
      "createFunction",
      awsError("InvalidParameterValueException", "The role defined for the function cannot be assumed by Lambda."),
      awsError("InvalidParameterValueException", "The role defined for the function cannot be assumed by Lambda."),
    );
    const out = await publish();

    expect(out.version).toBe("1");
    expect(aws.calls.filter((c) => c.startsWith("createFunction"))).toHaveLength(3);
    expect(aws.sleeps).toEqual([2_000, 3_000]);
  });

  test("it gives up after a bounded number of tries, with AWS's own error", async () => {
    const stuck = awsError("InvalidParameterValueException", "The role defined for the function cannot be assumed by Lambda.");
    aws.failNext("createFunction", ...Array.from({ length: 20 }, () => stuck));

    await expect(publish()).rejects.toThrow("cannot be assumed");
    expect(aws.sleeps.length).toBeLessThan(10);
  });

  test("any other error is not retried", async () => {
    aws.failNext("createFunction", awsError("AccessDeniedException", "not allowed"));
    await expect(publish()).rejects.toThrow("not allowed");
    expect(aws.sleeps).toHaveLength(0);
  });

  test("recognising the two errors", () => {
    expect(isRoleNotReady(awsError("InvalidParameterValueException", "The role defined for the function cannot be assumed by Lambda."))).toBe(true);
    expect(isRoleNotReady(awsError("InvalidParameterValueException", "Memory too low"))).toBe(false);
    expect(isRoleNotReady(awsError("AccessDeniedException", "cannot be assumed by Lambda"))).toBe(false);
    expect(isNotFound(awsError("ResourceNotFoundException"))).toBe(true);
    expect(isNotFound(awsError("NoSuchEntityException"))).toBe(true);
    expect(isNotFound(awsError("AccessDeniedException"))).toBe(false);
  });
});

describe("a later publish", () => {
  test("updates the configuration before the code, and makes no role or function", async () => {
    await publish(D1);
    aws.calls.length = 0;
    const out = await publish(D2, { NODE_ENV: "production", NEW_KEY: "x" });

    expect(aws.calls).toEqual([
      `functionExists ${FN}`,
      `getRole ${FN}`,
      `updateConfiguration ${FN}`,
      `updateCode ${FN}`,
      `createAlias ${aliasName(D2)} -> v2`,
      `createUrl ${aliasName(D2)}`,
    ]);
    // The version published next carries this publish's environment.
    expect(aws.last.env).toEqual({ NODE_ENV: "production", NEW_KEY: "x" });
    expect(out.version).toBe("2");
  });

  test("every deployment has its own alias and its own URL, and the older one keeps working", async () => {
    const one = await publish(D1);
    const two = await publish(D2);

    expect(one.alias).not.toBe(two.alias);
    expect(one.url).not.toBe(two.url);
    expect(aws.aliases.get(FN)!.map((a) => a.alias)).toEqual([aliasName(D1), aliasName(D2)]);
    expect(aws.urls.size).toBe(2);
  });
});

describe("a publish that died half way can start over", () => {
  test("a function row with no function behind it creates the function", async () => {
    resources.push({ id: "r1", projectId: PROJECT, kind: "LAMBDA_FUNCTION", providerId: FN, region: "eu-west-1", deletedAt: null });
    const out = await publish();

    expect(aws.functions.has(FN)).toBe(true);
    expect(aws.calls.some((c) => c.startsWith("createFunction"))).toBe(true);
    expect(out.version).toBe("1");
  });

  test("a role that already exists is adopted, not created again", async () => {
    aws.roles.set(FN, `arn:aws:iam::123456789012:role/tau-apps/${FN}`);
    await publish();
    expect(aws.calls.some((c) => c.startsWith("createRole"))).toBe(false);
    expect(aws.calls.some((c) => c.startsWith("createFunction"))).toBe(true);
  });

  test("a function whose role is gone says what to do, and changes nothing", async () => {
    await publish(D1);
    aws.roles.clear();
    aws.calls.length = 0;

    await expect(publish(D2)).rejects.toThrow("its role does not");
    expect(aws.calls.some((c) => c.startsWith("updateCode"))).toBe(false);
  });
});

describe("the environment", () => {
  test("names AWS reserves are refused before anything is created", async () => {
    await expect(publish(D1, { AWS_REGION: "x", GOOD: "y" })).rejects.toBeInstanceOf(LambdaEnvError);
    await expect(publish(D1, { AWS_SECRET_ACCESS_KEY: "x" })).rejects.toThrow("AWS_SECRET_ACCESS_KEY");
    await expect(publish(D1, { _HANDLER: "x" })).rejects.toThrow("_HANDLER");
    expect(aws.calls).toHaveLength(0);
    expect(resources).toHaveLength(0);
  });

  test("the message says what to do", () => {
    expect(() => validateLambdaEnv({ AWS_X: "1", AWS_Y: "2" })).toThrow(/key names.*Rename them/);
    expect(() => validateLambdaEnv({ AWS_X: "1" })).toThrow(/a key name.*Rename it/);
  });

  test("over 4 KB in total is refused, counting names and values, and exactly 4 KB is fine", () => {
    expect(() => validateLambdaEnv({ K: "x".repeat(ENV_LIMIT_BYTES - 1) })).not.toThrow();
    expect(() => validateLambdaEnv({ K: "x".repeat(ENV_LIMIT_BYTES) })).toThrow("over the 4096-byte limit");
    expect(() => validateLambdaEnv({ A: "x".repeat(2100), B: "y".repeat(2100) })).toThrow(LambdaEnvError);
    // Bytes, not characters.
    expect(() => validateLambdaEnv({ K: "é".repeat(2100) })).toThrow(LambdaEnvError);
  });

  test("an ordinary environment passes", () => {
    expect(() => validateLambdaEnv({ NODE_ENV: "production", TAU_API_KEY: "tau_sk_live_abc", STRIPE_KEY: "sk_test" })).not.toThrow();
  });
});

describe("pruning what can no longer be rolled back to", () => {
  async function three() {
    await publish(D1);
    await publish(D2);
    await publish(D3);
    aws.calls.length = 0;
  }

  test("removes the aliases and URLs of deployments not kept, then versions nothing refers to", async () => {
    await three();
    const out = await pruneBackend(PROJECT, new Set([D3]));

    expect(out).toEqual({ aliases: 2, versions: 2 });
    expect(aws.aliases.get(FN)!.map((a) => a.alias)).toEqual([aliasName(D3)]);
    expect(aws.urls).toEqual(new Set([`${FN}:${aliasName(D3)}`]));
    expect(aws.versions.get(FN)).toEqual(["3"]);
  });

  test("keeps every deployment it is told to", async () => {
    await three();
    expect(await pruneBackend(PROJECT, new Set([D1, D2, D3]))).toEqual({ aliases: 0, versions: 0 });
  });

  test("never touches an alias that is not a deployment's", async () => {
    await three();
    aws.aliases.get(FN)!.push({ alias: "manual", version: "2" });
    await pruneBackend(PROJECT, new Set([D3]));

    expect(aws.aliases.get(FN)!.map((a) => a.alias)).toContain("manual");
    expect(aws.versions.get(FN)).toContain("2");
  });

  test("a project with no function is nothing to prune", async () => {
    expect(await pruneBackend(PROJECT, new Set())).toEqual({ aliases: 0, versions: 0 });
  });

  test("a URL that is already gone does not stop the pass", async () => {
    await three();
    aws.urls.delete(`${FN}:${aliasName(D1)}`);
    expect((await pruneBackend(PROJECT, new Set([D3]))).aliases).toBe(2);
  });
});

describe("removing a project's backend", () => {
  test("deletes URLs and aliases, the function, the log group, then the role, and records it", async () => {
    await publish(D1);
    await publish(D2);
    aws.calls.length = 0;
    events.length = 0;
    await removeBackend(PROJECT);

    expect(aws.functions.size + aws.roles.size + aws.logGroups.size + aws.urls.size).toBe(0);
    const order = aws.calls.map((c) => c.split(" ")[0]);
    expect(order.indexOf("deleteUrl")).toBeLessThan(order.indexOf("deleteFunction"));
    expect(order.indexOf("deleteFunction")).toBeLessThan(order.indexOf("deleteLogGroup"));
    expect(order.indexOf("deleteRolePolicy")).toBeLessThan(order.indexOf("deleteRole"));
    expect(resources.every((r) => r.deletedAt !== null)).toBe(true);
  });

  test("can be run twice: what is already gone is not an error", async () => {
    await publish();
    await removeBackend(PROJECT);
    await expect(removeBackend(PROJECT)).resolves.toBeUndefined();
  });

  test("a project that never had a backend is nothing to remove", async () => {
    await expect(removeBackend(PROJECT)).resolves.toBeUndefined();
  });

  test("a real failure stops it, so the resources are not marked deleted", async () => {
    await publish();
    aws.failNext("deleteFunction", awsError("AccessDeniedException", "not allowed"));
    await expect(removeBackend(PROJECT)).rejects.toThrow("not allowed");
    expect(resources.find((r) => r.kind === "LAMBDA_FUNCTION")!.deletedAt).toBeNull();
  });

  test("a project published again after removal is recorded as live again", async () => {
    await publish();
    await removeBackend(PROJECT);
    await publish(D2);
    expect(resources.filter((r) => r.deletedAt === null).map((r) => r.kind).sort()).toEqual(["IAM_ROLE", "LAMBDA_FUNCTION"]);
  });
});

describe("whether hosting is on", () => {
  const set = (over: Partial<Record<string, any>>) => Object.assign(env as any, over);
  const original = { ...env } as any;
  const restore = () => set({
    BACKEND_HOSTING_ENABLED: original.BACKEND_HOSTING_ENABLED,
    AWS_APPS_REGION: original.AWS_APPS_REGION,
    AWS_APPS_ACCESS_KEY_ID: original.AWS_APPS_ACCESS_KEY_ID,
    AWS_APPS_SECRET_ACCESS_KEY: original.AWS_APPS_SECRET_ACCESS_KEY,
  });

  test("off by default, and when any setting is missing", () => {
    setLambdaDepsForTests(null);
    try {
      expect(hostingConfig()).toBeNull();
      set({ BACKEND_HOSTING_ENABLED: true });
      expect(hostingConfig()).toBeNull();
      set({ AWS_APPS_REGION: "eu-west-1", AWS_APPS_ACCESS_KEY_ID: "AKIA" });
      expect(hostingConfig()).toBeNull();
      expect(backendHostingAvailable()).toBe(false);
    } finally {
      restore();
    }
  });

  test("on only with the switch and all three settings", () => {
    setLambdaDepsForTests(null);
    try {
      set({ BACKEND_HOSTING_ENABLED: true, AWS_APPS_REGION: "eu-west-1", AWS_APPS_ACCESS_KEY_ID: "AKIA", AWS_APPS_SECRET_ACCESS_KEY: "s" });
      expect(hostingConfig()).toMatchObject({ region: "eu-west-1", reservedConcurrency: 2, memoryMb: 512, timeoutS: 15, logRetentionDays: 14 });
      expect(backendHostingAvailable()).toBe(true);

      set({ BACKEND_HOSTING_ENABLED: false });
      expect(hostingConfig()).toBeNull();
    } finally {
      restore();
    }
  });

  test("with it off, removal and pruning do nothing", async () => {
    setLambdaDepsForTests({ api: () => null });
    await removeBackend(PROJECT);
    expect(await pruneBackend(PROJECT, new Set())).toEqual({ aliases: 0, versions: 0 });
    await expect(publish()).rejects.toThrow("not configured");
  });
});

describe("refreshing a live server's environment", () => {
  test("republishes the live version's own code with the new environment and moves the alias, keeping its URL", async () => {
    const first = await publish(D1, { NODE_ENV: "production", KEY: "old" });
    aws.calls.length = 0;

    const out = await refreshBackendEnv({ projectId: PROJECT, deploymentId: D1, env: { NODE_ENV: "production", KEY: "new" } });

    expect(aws.calls).toEqual([
      `listAliases ${FN}`,
      `getRole ${FN}`,
      `getVersionCode ${FN} 1`,
      `updateConfiguration ${FN}`,
      `updateCode ${FN}`,
      `updateAlias ${FN} ${aliasName(D1)} ${out.version}`,
    ]);
    expect(out.version).not.toBe(first.version);
    expect(aws.last.env).toEqual({ NODE_ENV: "production", KEY: "new" });
    // The URL belongs to the alias, so nothing is created and the routing record stays valid.
    expect(aws.calls.some((c) => c.startsWith("createUrl") || c.startsWith("createAlias"))).toBe(false);
    expect((await aws.api.listAliases(FN)).find((a) => a.alias === aliasName(D1))?.version).toBe(out.version);
  });

  test("an alias that was pruned is a clear error, not a new deployment", async () => {
    await publish(D1);
    await expect(refreshBackendEnv({ projectId: PROJECT, deploymentId: "gone", env: { NODE_ENV: "production" } })).rejects.toThrow("no longer deployed");
  });

  test("an environment over the size limit is refused before anything is changed", async () => {
    await publish(D1);
    aws.calls.length = 0;
    await expect(refreshBackendEnv({ projectId: PROJECT, deploymentId: D1, env: { BIG: "x".repeat(5000) } })).rejects.toThrow();
    expect(aws.calls).toEqual([]);
  });
});
