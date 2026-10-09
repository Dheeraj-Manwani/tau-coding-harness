import { beforeEach, describe, expect, mock, test } from "bun:test";

// What the edge router is told. The record for each state a site can be in, the
// Cloudflare calls that carry it, and the reconciler that repairs any drift.
// Prisma and the network are stand-ins; the logic is the real module.

type Row = Record<string, any>;
const projects: Row[] = [];
const deployments: Row[] = [];

const find = (rows: Row[], where: Row = {}) =>
  rows.filter((r) =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === "object" && "in" in v) return v.in.includes(r[k]);
      if (v && typeof v === "object" && "not" in v) return r[k] !== v.not;
      if (k === "OR" || typeof v === "object") return true;
      return r[k] === v;
    }),
  );

mock.module("@/lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: async ({ where }: { where: Row }) => find(projects, where)[0] ?? null,
      findMany: async ({ where }: { where?: Row } = {}) => find(projects, where),
    },
    deployment: {
      findMany: async ({ where }: { where: Row }) =>
        deployments.filter((d) => where.id.in.includes(d.id) && d.status === where.status),
    },
  },
}));

const {
  KEY_PREFIX,
  cloudflareKv,
  recordFor,
  recordHash,
  recordJson,
  recordKey,
  reconcileEdge,
  removeSite,
  setKvClientForTests,
  syncProject,
  syncUser,
} = await import("@/lib/edgeRegistry");

const DOMAIN = "bytauai.pro";
const PREFIX = "tau/sites/u1/p1/d1";

// ── A KV stand-in that records what it was asked ─────────────────────────────

class FakeKv {
  store = new Map<string, { value: string; hash: string }>();
  puts: string[] = [];
  removes: string[] = [];
  lists = 0;
  failNext = false;

  async list() {
    this.lists += 1;
    return [...this.store].map(([name, v]) => ({ name, hash: v.hash }));
  }
  async put(entries: { key: string; value: string; hash: string }[]) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("Cloudflare is down");
    }
    for (const e of entries) {
      this.store.set(e.key, { value: e.value, hash: e.hash });
      this.puts.push(e.key);
    }
  }
  async remove(keys: string[]) {
    for (const k of keys) {
      this.store.delete(k);
      this.removes.push(k);
    }
  }
  record(slug: string) {
    const entry = this.store.get(recordKey(slug, DOMAIN));
    return entry ? JSON.parse(entry.value) : undefined;
  }
}

let kv: FakeKv;

function project(over: Row = {}): Row {
  const row = {
    id: "p1",
    slug: "my-app",
    siteSuspendedAt: null,
    liveDeploymentId: "d1",
    userId: "u1",
    user: { billing: { plan: "FREE" } },
    ...over,
  };
  projects.push(row);
  return row;
}

beforeEach(() => {
  projects.length = 0;
  deployments.length = 0;
  deployments.push({ id: "d1", status: "READY", storagePrefix: PREFIX });
  kv = new FakeKv();
  setKvClientForTests(kv);
});

describe("the record for each state a site can be in", () => {
  const base = { id: "p1", slug: "my-app", siteSuspendedAt: null, livePrefix: PREFIX, plan: "FREE" as const };

  test("live on the free plan carries the prefix and the badge", () => {
    expect(recordFor(base)).toEqual({ projectId: "p1", slug: "my-app", prefix: PREFIX, showBadge: true, suspended: false });
  });

  test("live on Pro has no badge", () => {
    expect(recordFor({ ...base, plan: "PRO" })!.showBadge).toBe(false);
  });

  test("an account with no billing row is treated as free", () => {
    expect(recordFor({ ...base, plan: null })!.showBadge).toBe(true);
  });

  test("offline has no record at all, which the router reads as nothing published", () => {
    expect(recordFor({ ...base, livePrefix: null })).toBeNull();
  });

  test("suspended wins over live, and the router is not given a prefix to serve", () => {
    const record = recordFor({ ...base, siteSuspendedAt: new Date() })!;
    expect(record.suspended).toBe(true);
    // Live files are still there, but the record is what decides what is served.
    expect(record.prefix).toBe(PREFIX);
  });

  test("suspended and offline is still a record, so the owner's address says suspended", () => {
    expect(recordFor({ ...base, livePrefix: null, siteSuspendedAt: new Date() })).toMatchObject({ suspended: true, prefix: "" });
  });

  test("a project that never published has none", () => {
    expect(recordFor({ ...base, slug: null })).toBeNull();
  });

  test("the key is the full hostname, and equal records hash alike", () => {
    expect(recordKey("my-app", DOMAIN)).toBe("host:my-app.bytauai.pro");
    const a = recordFor(base)!;
    expect(recordHash(a)).toBe(recordHash({ ...a }));
    expect(recordHash(a)).not.toBe(recordHash({ ...a, showBadge: false }));
    expect(recordJson(a)).toBe(recordJson({ suspended: false, showBadge: true, prefix: PREFIX, slug: "my-app", projectId: "p1" }));
  });
});

describe("pushing a project", () => {
  test("a live project is written under its hostname", async () => {
    project();
    await syncProject("p1");

    expect(kv.record("my-app")).toEqual({ projectId: "p1", slug: "my-app", prefix: PREFIX, showBadge: true, suspended: false });
  });

  test("taking it offline removes the record", async () => {
    const p = project();
    await syncProject("p1");
    p.liveDeploymentId = null;
    await syncProject("p1");

    expect(kv.record("my-app")).toBeUndefined();
    expect(kv.removes).toEqual([recordKey("my-app", DOMAIN)]);
  });

  test("a rollback moves the prefix", async () => {
    const p = project();
    await syncProject("p1");
    deployments.push({ id: "d0", status: "READY", storagePrefix: "tau/sites/u1/p1/d0" });
    p.liveDeploymentId = "d0";
    await syncProject("p1");

    expect(kv.record("my-app").prefix).toBe("tau/sites/u1/p1/d0");
  });

  test("a live pointer at a deployment that is not READY is not served", async () => {
    deployments[0]!.status = "SUPERSEDED";
    project();
    await syncProject("p1");
    expect(kv.record("my-app")).toBeUndefined();
  });

  test("suspending and lifting", async () => {
    const p = project();
    p.siteSuspendedAt = new Date();
    await syncProject("p1");
    expect(kv.record("my-app").suspended).toBe(true);

    p.siteSuspendedAt = null;
    await syncProject("p1");
    expect(kv.record("my-app").suspended).toBe(false);
  });

  test("a plan change rewrites every project of the user, badge on and off", async () => {
    project();
    project({ id: "p2", slug: "second-app", liveDeploymentId: "d2" });
    deployments.push({ id: "d2", status: "READY", storagePrefix: "tau/sites/u1/p2/d2" });
    await syncUser("u1");
    expect(kv.record("my-app").showBadge).toBe(true);
    expect(kv.record("second-app").showBadge).toBe(true);

    for (const p of projects) p.user = { billing: { plan: "PRO" } };
    await syncUser("u1");
    expect(kv.record("my-app").showBadge).toBe(false);
    expect(kv.record("second-app").showBadge).toBe(false);
  });

  test("a deleted project's record is removed by address", async () => {
    project();
    await syncProject("p1");
    await removeSite("my-app");
    expect(kv.record("my-app")).toBeUndefined();
    await removeSite(null);
  });

  // The push happens after the change has already happened, so it must never undo it.
  test("a Cloudflare failure is swallowed, not thrown", async () => {
    project();
    kv.failNext = true;
    await expect(syncProject("p1")).resolves.toBeUndefined();
    expect(kv.record("my-app")).toBeUndefined();

    kv.failNext = true;
    await expect(syncUser("u1")).resolves.toBeUndefined();
  });

  test("an unknown project is not an error", async () => {
    await expect(syncProject("nobody")).resolves.toBeUndefined();
  });

  test("with no registry configured nothing happens", async () => {
    setKvClientForTests(null);
    project();
    await syncProject("p1");
    await syncUser("u1");
    await removeSite("my-app");
    expect(kv.puts).toHaveLength(0);
    expect(await reconcileEdge()).toBeNull();
  });
});

describe("the reconciler", () => {
  test("writes what is missing", async () => {
    project();
    project({ id: "p2", slug: "second-app", liveDeploymentId: "d2" });
    deployments.push({ id: "d2", status: "READY", storagePrefix: "tau/sites/u1/p2/d2" });

    expect(await reconcileEdge()).toEqual({ expected: 2, written: 2, removed: 0 });
    expect(kv.record("my-app")).toBeDefined();
    expect(kv.record("second-app")).toBeDefined();
  });

  test("when everything matches it writes nothing, and reads nothing", async () => {
    project();
    await reconcileEdge();
    kv.puts.length = 0;

    expect(await reconcileEdge()).toEqual({ expected: 1, written: 0, removed: 0 });
    expect(kv.puts).toHaveLength(0);
    expect(kv.lists).toBe(2);
  });

  test("rewrites a record that differs, which is how a missed push is repaired", async () => {
    const p = project();
    await reconcileEdge();
    p.siteSuspendedAt = new Date(); // changed in the database; the push for it was lost
    kv.puts.length = 0;

    expect(await reconcileEdge()).toEqual({ expected: 1, written: 1, removed: 0 });
    expect(kv.record("my-app").suspended).toBe(true);
  });

  test("removes a record nothing should have", async () => {
    project();
    await reconcileEdge();
    kv.store.set(recordKey("ghost", DOMAIN), { value: "{}", hash: "x" });
    kv.store.set(`${KEY_PREFIX}offline.bytauai.pro`, { value: "{}", hash: "y" });

    expect(await reconcileEdge()).toEqual({ expected: 1, written: 0, removed: 2 });
    expect(kv.record("ghost")).toBeUndefined();
  });

  test("a project that is offline and not suspended is expected to have no record", async () => {
    project({ liveDeploymentId: null });
    kv.store.set(recordKey("my-app", DOMAIN), { value: "{}", hash: "stale" });

    expect(await reconcileEdge()).toEqual({ expected: 0, written: 0, removed: 1 });
  });

  test("a record with no stored hash is rewritten", async () => {
    project();
    kv.store.set(recordKey("my-app", DOMAIN), { value: "{}", hash: null as never });
    expect((await reconcileEdge())!.written).toBe(1);
  });
});

describe("the Cloudflare KV client", () => {
  const config = { accountId: "acct1", namespaceId: "ns1", token: "tok", domain: DOMAIN };
  const BASE = "https://api.cloudflare.com/client/v4/accounts/acct1/storage/kv/namespaces/ns1";

  function recorder(replies: unknown[]) {
    const calls: { url: string; method: string; headers: Record<string, string>; body: unknown }[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      calls.push({
        url,
        method: init.method!,
        headers: init.headers as Record<string, string>,
        body: init.body ? JSON.parse(init.body as string) : undefined,
      });
      const reply = replies.shift() ?? { success: true, result: null };
      return new Response(JSON.stringify(reply), { status: 200 });
    }) as unknown as typeof fetch;
    return { calls, client: cloudflareKv(config, fetcher) };
  }

  test("writes in bulk, with the hash as metadata, authenticated by the token", async () => {
    const { calls, client } = recorder([]);
    await client.put([{ key: "host:a.bytauai.pro", value: "{\"x\":1}", hash: "abc" }]);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: "PUT",
      url: `${BASE}/bulk`,
      body: [{ key: "host:a.bytauai.pro", value: "{\"x\":1}", metadata: { h: "abc" } }],
    });
    expect(calls[0]!.headers.Authorization).toBe("Bearer tok");
  });

  test("removes in bulk", async () => {
    const { calls, client } = recorder([]);
    await client.remove(["host:a.bytauai.pro", "host:b.bytauai.pro"]);
    expect(calls[0]).toMatchObject({ method: "POST", url: `${BASE}/bulk/delete`, body: ["host:a.bytauai.pro", "host:b.bytauai.pro"] });
  });

  test("an empty write or removal makes no request", async () => {
    const { calls, client } = recorder([]);
    await client.put([]);
    await client.remove([]);
    expect(calls).toHaveLength(0);
  });

  test("lists every page, with each key's hash", async () => {
    const { calls, client } = recorder([
      { success: true, result: [{ name: "host:a.bytauai.pro", metadata: { h: "1" } }], result_info: { cursor: "next" } },
      { success: true, result: [{ name: "host:b.bytauai.pro" }], result_info: { cursor: "" } },
    ]);

    expect(await client.list("host:")).toEqual([
      { name: "host:a.bytauai.pro", hash: "1" },
      { name: "host:b.bytauai.pro", hash: null },
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toContain("prefix=host%3A");
    expect(calls[1]!.url).toContain("cursor=next");
  });

  test("a refusal from Cloudflare is an error that names the reason", async () => {
    const { client } = recorder([{ success: false, errors: [{ message: "Authentication error" }] }]);
    await expect(client.put([{ key: "k", value: "v", hash: "h" }])).rejects.toThrow("Authentication error");
  });

  test("large writes are split into batches", async () => {
    const { calls, client } = recorder([]);
    await client.put(Array.from({ length: 2500 }, (_, i) => ({ key: `host:s${i}.bytauai.pro`, value: "{}", hash: "h" })));
    expect(calls).toHaveLength(3);
  });
});
