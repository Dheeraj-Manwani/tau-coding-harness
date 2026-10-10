import { beforeEach, describe, expect, mock, test } from "bun:test";

// The database lifecycle against a stand-in for Neon and an in-memory table:
// the row exists before the project does, a repeat adopts instead of creating
// twice, a deleted project's database waits out its delay, and the secret is
// stored only encrypted.

type Row = Record<string, any>;
let rows: Row[] = [];
const events: string[] = [];

const matches = (r: Row, where: Row): boolean =>
  Object.entries(where).every(([k, v]) => {
    if (v && typeof v === "object" && "startsWith" in v) return String(r[k]).startsWith(v.startsWith);
    if (v && typeof v === "object" && "lt" in v) return r[k] !== null && r[k] !== undefined && r[k] < v.lt;
    return r[k] === v;
  });

mock.module("@/lib/prisma", () => ({
  prisma: {
    projectResource: {
      findFirst: async ({ where }: { where: Row }) => rows.find((r) => matches(r, where)) ?? null,
      findMany: async ({ where }: { where: Row }) => rows.filter((r) => matches(r, where)),
      upsert: async ({ where, create, update }: { where: any; create: Row; update: Row }) => {
        const { kind, providerId } = where.kind_providerId;
        const found = rows.find((r) => r.kind === kind && r.providerId === providerId);
        events.push("db:record");
        if (found) return Object.assign(found, update);
        const row = { id: `r${rows.length + 1}`, deletedAt: null, deleteAfter: null, secretCiphertext: null, createdAt: new Date(), ...create };
        rows.push(row);
        return row;
      },
      update: async ({ where, data }: { where: any; data: Row }) => {
        const row = where.id
          ? rows.find((r) => r.id === where.id)
          : rows.find((r) => r.kind === where.kind_providerId.kind && r.providerId === where.kind_providerId.providerId);
        if (!row) throw new Error("no row");
        return Object.assign(row, data);
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const hit = rows.filter((r) => matches(r, where));
        for (const r of hit) Object.assign(r, data);
        return { count: hit.length };
      },
    },
  },
}));
mock.module("@/lib/apiKeys", () => ({
  encryptKey: (raw: string) => `enc(${raw.split("").reverse().join("")})`,
  decryptKey: (stored: string) => stored.slice(4, -1).split("").reverse().join(""),
}));

const { env } = await import("@/lib/env");
const { branchDatabase, databaseHostingAvailable, databaseName, ensureDatabase, scheduleDatabaseRemoval, setNeonApiForTests, sweepDatabases, NeonError } =
  await import("@/lib/neonApps");

const URL_ = "postgres://neondb_owner:pw@ep-x-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require";
let neon: ReturnType<typeof stand>;

function stand() {
  const s = { projects: new Map<string, { id: string; name: string }>(), deleted: [] as string[], branches: [] as string[], failCreate: false, api: null as any };
  s.api = {
    createProject: async (name: string) => {
      events.push("neon:create");
      if (s.failCreate) throw new NeonError("quota", 402);
      const p = { id: `proj-${s.projects.size + 1}`, name };
      s.projects.set(name, p);
      return { id: p.id, region: "aws-us-east-1" };
    },
    pooledUri: async () => URL_,
    createBranch: async (id: string, name: string) => {
      s.branches.push(`${id}:${name}`);
      return { id: `br-${s.branches.length}` };
    },
    deleteProject: async (id: string) => {
      events.push("neon:delete");
      if (![...s.projects.values()].some((p) => p.id === id)) throw new NeonError("gone", 404);
      s.deleted.push(id);
    },
    findProject: async (name: string) => {
      const p = s.projects.get(name);
      return p ? { id: p.id, region: "aws-us-east-1" } : null;
    },
  };
  return s;
}

beforeEach(() => {
  rows = [];
  events.length = 0;
  neon = stand();
  setNeonApiForTests(neon.api);
});

describe("ensureDatabase", () => {
  test("the first publish records a row, then creates, then stores the string encrypted", async () => {
    const r = await ensureDatabase("p1");
    expect(r).toEqual({ url: URL_, created: true });
    expect(events).toEqual(["db:record", "neon:create"]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.providerId).toBe("proj-1");
    expect(rows[0]!.secretCiphertext).not.toContain("postgres");
  });

  test("a second publish reuses the database and does not call Neon again", async () => {
    await ensureDatabase("p1");
    events.length = 0;
    expect(await ensureDatabase("p1")).toEqual({ url: URL_, created: false });
    expect(events).toEqual([]);
  });

  test("a publish that died after creating the project adopts it instead of making a second", async () => {
    neon.projects.set(databaseName("p1"), { id: "proj-existing", name: databaseName("p1") });
    rows.push({ id: "r0", projectId: "p1", kind: "NEON_PROJECT", providerId: "pending:p1", region: "x", secretCiphertext: null, deletedAt: null, deleteAfter: null, createdAt: new Date() });
    const r = await ensureDatabase("p1");
    expect(r.created).toBe(false);
    expect(events).not.toContain("neon:create");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.providerId).toBe("proj-existing");
  });

  test("a failure at Neon leaves the placeholder row for the next try", async () => {
    neon.failCreate = true;
    await expect(ensureDatabase("p1")).rejects.toThrow("quota");
    expect(rows.map((r) => r.providerId)).toEqual(["pending:p1"]);
    neon.failCreate = false;
    expect((await ensureDatabase("p1")).created).toBe(true);
    expect(rows).toHaveLength(1);
  });
});

test("branchDatabase names a restore point on the app's own project", async () => {
  await ensureDatabase("p1");
  expect(await branchDatabase("p1", "before-x")).toBe("br-1");
  expect(neon.branches).toEqual(["proj-1:before-x"]);
  await expect(branchDatabase("none", "x")).rejects.toThrow("no database");
});

describe("removal", () => {
  test("a deleted project's database waits for its delay, then goes, and the row is kept as the record", async () => {
    await ensureDatabase("p1");
    await scheduleDatabaseRemoval("p1");
    expect(rows[0]!.deleteAfter!.getTime()).toBeGreaterThan(Date.now() + (env.DATABASE_DELETE_DELAY_DAYS - 1) * 86_400_000);

    expect(await sweepDatabases()).toEqual({ removed: 0, adopted: 0, errors: [] });
    expect(neon.deleted).toEqual([]);

    rows[0]!.deleteAfter = new Date(Date.now() - 1000);
    rows[0]!.projectId = null; // what the project's deletion does to the row
    expect(await sweepDatabases()).toEqual({ removed: 1, adopted: 0, errors: [] });
    expect(neon.deleted).toEqual(["proj-1"]);
    expect(rows[0]!.deletedAt).not.toBeNull();
    expect(rows[0]!.secretCiphertext).toBeNull();
    expect(await sweepDatabases()).toEqual({ removed: 0, adopted: 0, errors: [] });
  });

  test("a project Neon no longer has counts as removed; any other failure is reported and retried", async () => {
    await ensureDatabase("p1");
    rows[0]!.deleteAfter = new Date(Date.now() - 1000);
    neon.projects.clear();
    expect((await sweepDatabases()).removed).toBe(1);

    rows = [];
    await ensureDatabase("p2");
    rows[0]!.deleteAfter = new Date(Date.now() - 1000);
    neon.api.deleteProject = async () => {
      throw new NeonError("boom", 500);
    };
    const r = await sweepDatabases();
    expect(r.removed).toBe(0);
    expect(r.errors[0]).toContain("boom");
    expect(rows[0]!.deletedAt).toBeNull();
  });

  test("a placeholder older than an hour is adopted if the project exists, dropped if not", async () => {
    const old = new Date(Date.now() - 2 * 3_600_000);
    rows.push({ id: "a", projectId: "p1", kind: "NEON_PROJECT", providerId: "pending:p1", region: "x", secretCiphertext: null, deletedAt: null, deleteAfter: null, createdAt: old });
    rows.push({ id: "b", projectId: "p2", kind: "NEON_PROJECT", providerId: "pending:p2", region: "x", secretCiphertext: null, deletedAt: null, deleteAfter: null, createdAt: old });
    neon.projects.set(databaseName("p1"), { id: "proj-9", name: databaseName("p1") });
    const r = await sweepDatabases();
    expect(r.adopted).toBe(1);
    expect(rows.find((x) => x.id === "a")!.providerId).toBe("proj-9");
    expect(rows.find((x) => x.id === "b")!.deletedAt).not.toBeNull();
  });
});

test("database hosting is available only with a key (or a test stand-in)", () => {
  setNeonApiForTests(null);
  const saved = env.NEON_API_KEY;
  env.NEON_API_KEY = undefined;
  expect(databaseHostingAvailable()).toBe(false);
  env.NEON_API_KEY = "k";
  expect(databaseHostingAvailable()).toBe(true);
  env.NEON_API_KEY = saved;
});
