// Runs in its own process (see storageService.test.ts) because mock.module is global.
// Drives the real routes, middleware and service against an in-memory database
// and bucket.
process.env.TAU_KEY_ENC_SECRET = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
process.env.STORAGE_RPM = "40";

import { beforeEach, afterAll, describe, expect, mock, test } from "bun:test";
import express from "express";

type Row = Record<string, any>;
const PA = "00000000-0000-4000-8000-00000000000a";
const PB = "00000000-0000-4000-8000-00000000000b";
const PC = "00000000-0000-4000-8000-00000000000c";
const PNONE = "00000000-0000-4000-8000-0000000000ff";
const ids: Record<string, string> = { A: PA, B: PB, C: PC, nope: PNONE };
const tables: Record<"storageObject" | "storageKey", Row[]> = { storageObject: [], storageKey: [] };
const projects: Record<string, Row> = {};
const billing: Record<string, Row> = {};
let seq = 0;

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([field, cond]) => {
    const v = row[field];
    if (cond !== null && typeof cond === "object" && !(cond instanceof Date) && typeof cond !== "bigint") {
      if ("in" in cond && !cond.in.includes(v)) return false;
      if ("not" in cond && v === cond.not) return false;
      if ("startsWith" in cond && !String(v).startsWith(cond.startsWith)) return false;
      if ("gt" in cond && !(v > cond.gt)) return false;
      if ("lt" in cond && !(v < cond.lt)) return false;
      return true;
    }
    return v === cond;
  });
}

function table(name: "storageObject" | "storageKey") {
  const rows = tables[name];
  return {
    findFirst: async ({ where }: Row) => rows.find((r) => matches(r, where)) ?? null,
    findUnique: async ({ where }: Row) => rows.find((r) => matches(r, where)) ?? null,
    findUniqueOrThrow: async ({ where }: Row) => {
      const r = rows.find((x) => matches(x, where));
      if (!r) throw new Error("not found");
      return r;
    },
    findMany: async ({ where, orderBy, take }: Row = {}) => {
      let out = rows.filter((r) => matches(r, where));
      if (orderBy?.key) out = [...out].sort((a, b) => (a.key < b.key ? -1 : 1));
      return take ? out.slice(0, take) : out;
    },
    count: async ({ where }: Row = {}) => rows.filter((r) => matches(r, where)).length,
    create: async ({ data }: Row) => {
      const row = { id: `id-${++seq}`, status: "PENDING", metadata: null, createdAt: new Date(), lastUsedAt: null, revokeAfter: null, ...data };
      if (name === "storageKey") row.status = data.status ?? "ACTIVE";
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: Row) => Object.assign(rows.find((r) => matches(r, where))!, data),
    updateMany: async ({ where, data }: Row) => {
      const hit = rows.filter((r) => matches(r, where));
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    },
    deleteMany: async ({ where }: Row) => {
      const hit = rows.filter((r) => matches(r, where));
      for (const r of hit) rows.splice(rows.indexOf(r), 1);
      return { count: hit.length };
    },
    groupBy: async ({ by, where, orderBy, take }: Row) => {
      const groups = new Map<string, Row[]>();
      for (const r of rows.filter((x) => matches(x, where))) {
        const k = by.map((f: string) => r[f]).join("|");
        groups.set(k, [...(groups.get(k) ?? []), r]);
      }
      let out = [...groups.values()].map((rs) => ({
        ...Object.fromEntries(by.map((f: string) => [f, rs[0]![f]])),
        _count: { _all: rs.length },
        _sum: { sizeBytes: rs.reduce((n, r) => n + r.sizeBytes, 0n) },
      })) as Row[];
      if (orderBy?._sum) out = out.sort((x, y) => (x._sum.sizeBytes < y._sum.sizeBytes ? 1 : -1));
      if (orderBy?._count) out = out.sort((x, y) => y._count._all - x._count._all);
      return take ? out.slice(0, take) : out;
    },
    aggregate: async ({ where }: Row) => ({
      _sum: { sizeBytes: rows.filter((r) => matches(r, where)).reduce((n, r) => n + r.sizeBytes, 0n) },
    }),
  };
}

const fakePrisma: Row = {
  storageObject: table("storageObject"),
  storageKey: table("storageKey"),
  project: {
    findUnique: async ({ where }: Row) => Object.values(projects).find((p) => p.id === where.id) ?? null,
    findMany: async ({ where }: Row) => Object.values(projects).filter((p) => where.id.in.includes(p.id)),
    update: async ({ where, data }: Row) => Object.assign(Object.values(projects).find((p) => p.id === where.id)!, data),
  },
  $queryRaw: async () => [],
  billingAccount: { findUnique: async ({ where }: Row) => billing[where.userId] ?? null },
  $transaction: async (cb: (tx: Row) => unknown) => cb(fakePrisma),
};
mock.module("@/lib/prisma", () => ({ prisma: fakePrisma }));

// The bucket: objects are keyed by their R2 key, with the size they hold.
const bucket = new Map<string, number>();
const signed: { key: string; opts: Row }[] = [];
mock.module("@/lib/storageBucket", () => ({
  storageConfigured: () => true,
  storageObjectKey: (p: string, e: string, id: string) => `apps/${p}/${e.toLowerCase()}/${id}`,
  projectStoragePrefix: (p: string) => `apps/${p}/`,
  presignStoragePut: async (key: string, opts: Row) => {
    signed.push({ key, opts });
    return `https://r2.test/put/${key}?len=${opts.size}`;
  },
  presignStorageGet: async (key: string, opts: Row) => {
    signed.push({ key, opts });
    return `https://r2.test/get/${key}?d=${encodeURIComponent(opts.disposition)}&t=${encodeURIComponent(opts.contentType)}`;
  },
  headStorageObject: async (key: string) => (bucket.has(key) ? { size: bucket.get(key)! } : null),
  STORAGE_PREFIX: "apps/",
  listStorageKeys: async (prefix: string) => [...bucket.keys()].filter((k) => k.startsWith(prefix)),
  deleteStorageObjects: async (keys: string[]) => {
    keys.forEach((k) => bucket.delete(k));
    return [];
  },
}));

const { Errors } = await import("@/api/lib/errors");
mock.module("@/api/middleware/auth.middleware", () => ({
  requireUserId: (req: express.Request) => {
    const id = req.headers["x-test-user"];
    if (typeof id !== "string") throw Errors.unauthorized();
    return id;
  },
}));
const refreshCalls: string[] = [];
let refreshOutcome: { status: string } = { status: "refreshed" };
mock.module("@/lib/refreshSecrets", () => ({
  refreshLiveBackend: async (id: string) => {
    refreshCalls.push(id);
    return refreshOutcome;
  },
}));
const ownerCtl = await import("@/api/controllers/storageOwner.controller");
const adminCtl = await import("@/api/controllers/admin.controller");
const { reconcileStorage, diffStorage } = await import("@/lib/reconcileStorage");
const { storageAnomalies } = await import("@/api/lib/anomalies");
const { storageObjectKey: r2KeyFor } = await import("@/lib/storageBucket");
const { default: routes } = await import("@/api/routes/storage.routes");
const { __resetStorageLimiter } = await import("@/api/middleware/storageKey.middleware");
const { ensureStorageKey, rotateStorageKey, revokeStorageKeys } = await import("@/lib/storageKeys");
const { sweepStorage } = await import("@/api/services/storage.service");

const app = express();
app.use(express.json());
app.use("/storage", routes);
const projectRouter = express.Router();
projectRouter.get("/:projectId/storage", ownerCtl.getOverview);
projectRouter.get("/:projectId/storage/files", ownerCtl.listFiles);
projectRouter.post("/:projectId/storage/files/url", ownerCtl.fileUrl);
projectRouter.post("/:projectId/storage/files/delete", ownerCtl.deleteFiles);
projectRouter.post("/:projectId/storage/clear", ownerCtl.clearPreview);
projectRouter.post("/:projectId/storage/rotate-key", ownerCtl.rotateKey);
app.use("/project", projectRouter);
// The admin router sits behind a gate in the real app; here a header names the admin.
const adminRouter = express.Router();
adminRouter.use((req, _res, next) => {
  const id = req.headers["x-test-admin"];
  if (typeof id === "string") req.user = { id, email: "admin@example.com" } as never;
  next();
});
adminRouter.get("/storage", adminCtl.storageOverview);
adminRouter.get("/projects/:id/storage/files", adminCtl.storageFiles);
adminRouter.post("/projects/:id/storage/suspend", adminCtl.suspendStorage);
adminRouter.post("/projects/:id/storage/resume", adminCtl.resumeStorage);
adminRouter.post("/projects/:id/storage/files/delete", adminCtl.deleteStorageFile);
app.use("/admin", adminRouter);
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(err.statusCode ?? 500).json({ error: err.message });
});
const server = app.listen(0);
const root = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const base = `${root}/storage`;
afterAll(() => server.close());

const call = (key: string | null, method: string, path: string, body?: unknown) =>
  fetch(base + path, {
    method,
    headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, json: (await r.json()) as any }));

/** Create, "upload" (put the declared bytes in the bucket) and complete. */
async function put(key: string, name: string, size = 10, type = "image/png") {
  const up = await call(key, "POST", "/uploads", { key: name, contentType: type, size });
  expect(up.status).toBe(201);
  const r2Key = new URL(up.json.uploadUrl).pathname.replace("/put/", "");
  bucket.set(r2Key, size);
  return call(key, "POST", `/uploads/${up.json.id}/complete`);
}

let previewA = "", liveA = "", previewB = "";
beforeEach(async () => {
  tables.storageObject.length = 0;
  tables.storageKey.length = 0;
  bucket.clear();
  signed.length = 0;
  __resetStorageLimiter();
  projects.A = { id: PA, userId: "owner", storageEnabled: true, storageSuspendedAt: null };
  projects.B = { id: PB, userId: "owner", storageEnabled: true, storageSuspendedAt: null };
  projects.C = { id: PC, userId: "someone-else", storageEnabled: true, storageSuspendedAt: null };
  billing.owner = { plan: "FREE" };
  previewA = (await ensureStorageKey(PA, "owner", "PREVIEW")).key;
  liveA = (await ensureStorageKey(PA, "owner", "LIVE")).key;
  previewB = (await ensureStorageKey(PB, "owner", "PREVIEW")).key;
});

describe("upload flow", () => {
  test("create, upload, complete, list, sign, move, delete", async () => {
    const done = await put(previewA, "users/1/report.pdf", 12, "application/pdf");
    expect(done.status).toBe(200);
    expect(done.json.file).toMatchObject({ key: "users/1/report.pdf", name: "report.pdf", size: 12, contentType: "application/pdf" });

    const list = await call(previewA, "GET", "/files?prefix=users/1/");
    expect(list.json.files.map((f: any) => f.key)).toEqual(["users/1/report.pdf"]);

    const url = await call(previewA, "POST", "/files/url", { key: "users/1/report.pdf" });
    expect(url.status).toBe(200);
    expect(url.json.url).toContain("inline");

    const moved = await call(previewA, "POST", "/files/move", { from: "users/1/report.pdf", to: "users/1/final.pdf" });
    expect(moved.json.file.key).toBe("users/1/final.pdf");
    expect((await call(previewA, "GET", "/files/info?key=users/1/report.pdf")).status).toBe(404);

    const del = await call(previewA, "POST", "/files/delete", { keys: ["users/1/final.pdf"] });
    expect(del.json.deleted).toBe(1);
    expect((await call(previewA, "GET", "/files")).json.files).toEqual([]);
    expect(bucket.size).toBe(0);
  });

  test("the size and type are signed into the address", async () => {
    await call(previewA, "POST", "/uploads", { key: "a.png", contentType: "image/png", size: 7 });
    expect(signed[0]!.opts).toMatchObject({ size: 7, contentType: "image/png" });
  });

  test("completing before the bytes arrive is upload_incomplete and can be retried", async () => {
    const up = await call(previewA, "POST", "/uploads", { key: "a.txt", size: 3 });
    const early = await call(previewA, "POST", `/uploads/${up.json.id}/complete`);
    expect(early.status).toBe(409);
    expect(early.json.code).toBe("upload_incomplete");
    bucket.set(new URL(up.json.uploadUrl).pathname.replace("/put/", ""), 3);
    expect((await call(previewA, "POST", `/uploads/${up.json.id}/complete`)).status).toBe(200);
  });

  test("an object of the wrong size is refused and removed", async () => {
    const up = await call(previewA, "POST", "/uploads", { key: "a.txt", size: 3 });
    const r2Key = new URL(up.json.uploadUrl).pathname.replace("/put/", "");
    bucket.set(r2Key, 999);
    const res = await call(previewA, "POST", `/uploads/${up.json.id}/complete`);
    expect(res.json.code).toBe("upload_incomplete");
    expect(bucket.has(r2Key)).toBe(false);
    expect((await call(previewA, "GET", "/files")).json.files).toEqual([]);
  });

  test("completing twice is harmless", async () => {
    const first = await put(previewA, "a.txt", 3, "text/plain");
    const again = await call(previewA, "POST", `/uploads/${first.json.file.id}/complete`);
    expect(again.status).toBe(200);
  });

  test("overwrite retires the old row and object", async () => {
    const first = await put(previewA, "a.txt", 3, "text/plain");
    const second = await put(previewA, "a.txt", 5, "text/plain");
    expect(second.status).toBe(200);
    const list = await call(previewA, "GET", "/files");
    expect(list.json.files).toHaveLength(1);
    expect(list.json.files[0].size).toBe(5);
    expect(tables.storageObject.filter((r) => r.status === "READY")).toHaveLength(1);
    expect(bucket.size).toBe(1);
    expect(first.json.file.id).not.toBe(second.json.file.id);
  });

  test("an upload that is never completed changes nothing", async () => {
    await put(previewA, "a.txt", 3, "text/plain");
    await call(previewA, "POST", "/uploads", { key: "a.txt", size: 9 });
    const list = await call(previewA, "GET", "/files");
    expect(list.json.files[0].size).toBe(3);
  });
});

describe("listing", () => {
  test("pages with a cursor, in name order", async () => {
    for (const n of ["c", "a", "b"]) await put(previewA, `f/${n}`, 1);
    const one = await call(previewA, "GET", "/files?limit=2");
    expect(one.json.files.map((f: any) => f.key)).toEqual(["f/a", "f/b"]);
    const two = await call(previewA, "GET", `/files?limit=2&cursor=${one.json.nextCursor}`);
    expect(two.json.files.map((f: any) => f.key)).toEqual(["f/c"]);
    expect(two.json.nextCursor).toBeNull();
  });
});

describe("rules", () => {
  test("bad keys and bodies are 400", async () => {
    for (const key of ["", "/abs", "a//b", "../x", "a/./b", "a\u0000b"]) {
      const res = await call(previewA, "POST", "/uploads", { key, size: 1 });
      expect(res.status).toBe(400);
      expect(res.json.code).toBe("invalid_key");
    }
    expect((await call(previewA, "POST", "/uploads", { key: "a", size: -1 })).json.code).toBe("invalid_request");
    expect((await call(previewA, "POST", "/uploads", { key: "a", size: 1, metadata: "x".repeat(3000) })).json.code).toBe("invalid_request");
  });

  test("a file over the plan's largest is file_too_large; the allowance is storage_full", async () => {
    const big = await call(previewA, "POST", "/uploads", { key: "big", size: 11 * 1024 * 1024 });
    expect(big.status).toBe(413);
    expect(big.json.code).toBe("file_too_large");

    // Preview cap is 50 MB: five 10 MB files fit, the sixth does not.
    for (let i = 0; i < 5; i++) expect((await put(previewA, `f${i}`, 10 * 1024 * 1024)).status).toBe(200);
    const full = await call(previewA, "POST", "/uploads", { key: "f5", size: 1024 * 1024 });
    expect(full.status).toBe(413);
    expect(full.json.code).toBe("storage_full");
    // Existing files still list, sign and delete.
    expect((await call(previewA, "GET", "/files")).json.files).toHaveLength(5);
    expect((await call(previewA, "POST", "/files/url", { key: "f0" })).status).toBe(200);
    expect((await call(previewA, "POST", "/files/delete", { keys: ["f0"] })).json.deleted).toBe(1);
  });

  test("overwriting at the limit is allowed because the old bytes free up", async () => {
    for (let i = 0; i < 5; i++) await put(previewA, `f${i}`, 10 * 1024 * 1024);
    const res = await call(previewA, "POST", "/uploads", { key: "f0", size: 10 * 1024 * 1024 });
    expect(res.status).toBe(201);
  });

  test("the account allowance spans projects", async () => {
    // 100 MB free: two preview projects at 50 MB each fill it.
    for (let i = 0; i < 5; i++) await put(previewA, `a${i}`, 10 * 1024 * 1024);
    for (let i = 0; i < 5; i++) await put(previewB, `b${i}`, 10 * 1024 * 1024);
    const res = await call(liveA, "POST", "/uploads", { key: "x", size: 1024 });
    expect(res.json.code).toBe("storage_full");
  });

  test("a plan change deletes nothing and a downgrade is read-only", async () => {
    billing.owner = { plan: "PRO" };
    await put(liveA, "big", 100 * 1024 * 1024);
    billing.owner = { plan: "FREE" };
    expect((await call(liveA, "POST", "/uploads", { key: "more", size: 1 })).json.code).toBe("storage_full");
    expect((await call(liveA, "GET", "/files")).json.files).toHaveLength(1);
    expect((await call(liveA, "POST", "/files/url", { key: "big" })).status).toBe(200);
  });

  test("HTML and SVG are always downloads; a picture is inline unless asked", async () => {
    await put(previewA, "page.html", 3, "text/html");
    await put(previewA, "logo.svg", 3, "image/svg+xml");
    await put(previewA, "pic.png", 3, "image/png");
    for (const k of ["page.html", "logo.svg"]) {
      const u = (await call(previewA, "POST", "/files/url", { key: k })).json.url;
      expect(decodeURIComponent(u)).toContain("attachment");
      expect(decodeURIComponent(u)).toContain("application/octet-stream");
    }
    expect(decodeURIComponent((await call(previewA, "POST", "/files/url", { key: "pic.png" })).json.url)).toContain("inline");
    expect(decodeURIComponent((await call(previewA, "POST", "/files/url", { key: "pic.png", download: true })).json.url)).toContain("attachment");
  });

  test("urls signs many at once and leaves unknown names null", async () => {
    await put(previewA, "a.png", 1);
    const res = await call(previewA, "POST", "/files/urls", { keys: ["a.png", "nope.png"] });
    expect(res.json.urls[0].url).toContain("https://r2.test/get/");
    expect(res.json.urls[1].url).toBeNull();
  });

  test("delete by prefix needs a non-empty prefix", async () => {
    await put(previewA, "tmp/a", 1);
    await put(previewA, "tmp/b", 1);
    await put(previewA, "keep/c", 1);
    expect((await call(previewA, "POST", "/files/delete", { prefix: "" })).status).toBe(400);
    expect((await call(previewA, "POST", "/files/delete", { prefix: "tmp/" })).json.deleted).toBe(2);
    expect((await call(previewA, "GET", "/files")).json.files.map((f: any) => f.key)).toEqual(["keep/c"]);
  });

  test("usage reports the allowance", async () => {
    await put(previewA, "a", 100);
    const u = await call(previewA, "GET", "/usage");
    expect(u.json).toMatchObject({ usedBytes: 100, fileCount: 1, quotaBytes: 100 * 1024 * 1024, maxFileBytes: 10 * 1024 * 1024 });
  });
});

describe("keys and isolation", () => {
  test("no key, a wrong key and an AI gateway key are all 401", async () => {
    expect((await call(null, "GET", "/files")).json.code).toBe("missing_api_key");
    expect((await call("tau_st_" + "x".repeat(43), "GET", "/files")).json.code).toBe("invalid_api_key");
    expect((await call("tau_sk_live_" + "x".repeat(43), "GET", "/files")).json.code).toBe("invalid_api_key");
  });

  test("project A's key cannot see project B's files", async () => {
    await put(previewB, "secret.txt", 3, "text/plain");
    expect((await call(previewA, "GET", "/files")).json.files).toEqual([]);
    expect((await call(previewA, "GET", "/files/info?key=secret.txt")).status).toBe(404);
    expect((await call(previewA, "POST", "/files/url", { key: "secret.txt" })).status).toBe(404);
    expect((await call(previewA, "POST", "/files/delete", { keys: ["secret.txt"] })).json.deleted).toBe(0);
    expect((await call(previewB, "GET", "/files")).json.files).toHaveLength(1);
  });

  test("a preview key cannot touch live files, and the reverse", async () => {
    await put(liveA, "same.txt", 3, "text/plain");
    expect((await call(previewA, "GET", "/files")).json.files).toEqual([]);
    expect((await call(previewA, "POST", "/files/delete", { keys: ["same.txt"] })).json.deleted).toBe(0);
    await put(previewA, "same.txt", 3, "text/plain");
    expect((await call(liveA, "GET", "/files")).json.files).toHaveLength(1);
  });

  test("a request cannot change the project or environment", async () => {
    await put(previewB, "b.txt", 1);
    const res = await fetch(`${base}/files`, {
      headers: { Authorization: `Bearer ${previewA}`, "X-Tau-Project": "B", "X-Tau-Env": "LIVE" },
    });
    expect((await res.json() as any).files).toEqual([]);
    expect((await call(previewA, "POST", "/uploads", { key: "z", size: 1, projectId: "B", env: "LIVE" })).status).toBe(201);
    expect(tables.storageObject.at(-1)).toMatchObject({ projectId: PA, env: "PREVIEW" });
  });

  test("a completion id from another project is not found", async () => {
    const up = await call(previewB, "POST", "/uploads", { key: "x", size: 1 });
    expect((await call(previewA, "POST", `/uploads/${up.json.id}/complete`)).status).toBe(404);
  });

  test("a revoked key and a closed grace window are refused; the grace window works", async () => {
    const rotated = await rotateStorageKey(PA, "owner", "PREVIEW");
    expect((await call(previewA, "GET", "/files")).status).toBe(200); // old key, inside grace
    expect((await call(rotated.key, "GET", "/files")).status).toBe(200);
    tables.storageKey.find((k) => k.status === "ROTATING")!.revokeAfter = new Date(Date.now() - 1000);
    expect((await call(previewA, "GET", "/files")).status).toBe(401);
    await revokeStorageKeys(PA);
    expect((await call(rotated.key, "GET", "/files")).status).toBe(401);
  });

  test("a suspended project is refused but its files are kept", async () => {
    await put(previewA, "keep.txt", 3, "text/plain");
    projects.A!.storageSuspendedAt = new Date();
    const res = await call(previewA, "GET", "/files");
    expect(res.status).toBe(403);
    expect(res.json.code).toBe("storage_suspended");
    expect((await call(previewA, "POST", "/uploads", { key: "n", size: 1 })).status).toBe(403);
    expect(tables.storageObject.filter((r) => r.status === "READY")).toHaveLength(1);
    projects.A!.storageSuspendedAt = null;
    expect((await call(previewA, "GET", "/files")).json.files).toHaveLength(1);
  });

  test("a flood from one key hits the rate limit; another key is unaffected", async () => {
    let limited = 0;
    for (let i = 0; i < 45; i++) if ((await call(previewA, "GET", "/usage")).status === 429) limited++;
    expect(limited).toBe(5);
    expect((await call(previewB, "GET", "/usage")).status).toBe(200);
  });
});

describe("sweep", () => {
  test("stale pending uploads go, fresh ones stay, and failed deletes are retried", async () => {
    const stale = await call(previewA, "POST", "/uploads", { key: "stale", size: 1 });
    const fresh = await call(previewA, "POST", "/uploads", { key: "fresh", size: 1 });
    tables.storageObject.find((r) => r.id === stale.json.id)!.createdAt = new Date(Date.now() - 2 * 3_600_000);
    const stuck = await put(previewA, "stuck", 1);
    tables.storageObject.find((r) => r.id === stuck.json.file.id)!.status = "DELETING";

    const result = await sweepStorage();
    expect(result.stale).toBe(1);
    const left = tables.storageObject.map((r) => r.id);
    expect(left).toEqual([fresh.json.id]);
    expect(bucket.size).toBe(0);
  });
});

describe("the owner routes (Tools -> Storage)", () => {
  const own = (method: string, path: string, body?: unknown, user: string | null = "owner") =>
    fetch(`${root}/project${path.replace(/^\/(A|B|C|nope)\//, (_m, k: string) => `/${ids[k]}/`)}`, {
      method,
      headers: { "Content-Type": "application/json", ...(user ? { "x-test-user": user } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(async (r) => ({ status: r.status, json: (await r.json()) as any }));

  test("the overview reports usage, plan limits and the files per environment", async () => {
    await put(previewA, "a", 100);
    await put(previewA, "b", 50);
    const o = await own("GET", "/A/storage");
    expect(o.status).toBe(200);
    expect(o.json).toMatchObject({
      enabled: true,
      suspended: false,
      usage: { usedBytes: 150, quotaBytes: 100 * 1024 * 1024, maxFileBytes: 10 * 1024 * 1024 },
    });
    expect(o.json.environments[0]).toEqual({ env: "PREVIEW", fileCount: 2, usedBytes: 150 });
  });

  test("Live appears once a live key exists, and not before", async () => {
    // beforeEach minted a LIVE key for A and none for B.
    expect((await own("GET", "/A/storage")).json.environments.map((e: any) => e.env)).toEqual(["PREVIEW", "LIVE"]);
    expect((await own("GET", "/B/storage")).json.environments.map((e: any) => e.env)).toEqual(["PREVIEW"]);
  });

  test("another user's project and an unknown one are both 404; no session is 401", async () => {
    expect((await own("GET", "/C/storage")).status).toBe(404);
    expect((await own("GET", "/nope/storage")).status).toBe(404);
    expect((await own("GET", "/C/storage/files")).status).toBe(404);
    expect((await own("POST", "/C/storage/clear")).status).toBe(404);
    expect((await own("POST", "/C/storage/files/delete", { keys: ["x"] })).status).toBe(404);
    expect((await own("POST", "/C/storage/files/url", { key: "x" })).status).toBe(404);
    expect((await own("GET", "/A/storage", undefined, null)).status).toBe(401);
  });

  test("the listing is the one the app key sees, per environment", async () => {
    await put(previewA, "docs/a.txt", 3, "text/plain");
    await put(liveA, "live/b.txt", 3, "text/plain");
    const viaKey = (await call(previewA, "GET", "/files")).json.files;
    expect((await own("GET", "/A/storage/files?env=PREVIEW")).json.files).toEqual(viaKey);
    expect((await own("GET", "/A/storage/files?env=LIVE")).json.files.map((f: any) => f.key)).toEqual(["live/b.txt"]);
    expect((await own("GET", "/A/storage/files?prefix=docs/")).json.files).toHaveLength(1);
  });

  test("a preview address opens a picture inline and downloads on request", async () => {
    await put(previewA, "p.png", 3, "image/png");
    expect(decodeURIComponent((await own("POST", "/A/storage/files/url", { key: "p.png" })).json.url)).toContain("inline");
    expect(decodeURIComponent((await own("POST", "/A/storage/files/url", { key: "p.png", download: true })).json.url)).toContain("attachment");
    expect((await own("POST", "/A/storage/files/url", { key: "missing" })).status).toBe(404);
  });

  test("delete by keys and by prefix; the body must name exactly one of them", async () => {
    await put(previewA, "t/a", 1);
    await put(previewA, "t/b", 1);
    await put(previewA, "k", 1);
    expect((await own("POST", "/A/storage/files/delete", { keys: ["k"] })).json.deleted).toBe(1);
    expect((await own("POST", "/A/storage/files/delete", { prefix: "t/" })).json.deleted).toBe(2);
    expect((await own("POST", "/A/storage/files/delete", {})).status).toBe(400);
    expect((await own("POST", "/A/storage/files/delete", { keys: ["a"], prefix: "b" })).status).toBe(400);
    expect(bucket.size).toBe(0);
  });

  test("clear removes the preview files and never touches live ones", async () => {
    await put(previewA, "p1", 1);
    await put(previewA, "p2", 1);
    await put(liveA, "keep-me", 1);
    await call(previewA, "POST", "/uploads", { key: "pending", size: 1 });
    const res = await own("POST", "/A/storage/clear");
    expect(res.json.deleted).toBe(3); // two files and the unconfirmed upload
    expect((await call(previewA, "GET", "/files")).json.files).toEqual([]);
    expect((await call(liveA, "GET", "/files")).json.files.map((f: any) => f.key)).toEqual(["keep-me"]);
    expect(bucket.size).toBe(1);
    // There is no way to ask it to clear Live.
    expect((await own("POST", "/A/storage/clear", { env: "LIVE" })).json.deleted).toBe(0);
    expect((await call(liveA, "GET", "/files")).json.files).toHaveLength(1);
  });

  test("suspended: the pane still lists, but no new addresses", async () => {
    await put(previewA, "s.txt", 1, "text/plain");
    projects.A!.storageSuspendedAt = new Date();
    expect((await own("GET", "/A/storage")).json.suspended).toBe(true);
    expect((await own("GET", "/A/storage/files")).json.files).toHaveLength(1);
    expect((await own("POST", "/A/storage/files/url", { key: "s.txt" })).status).toBe(403);
  });

  test("a project that never enabled storage says so", async () => {
    projects.B!.storageEnabled = false;
    const o = await own("GET", "/B/storage");
    expect(o.json.enabled).toBe(false);
    expect(o.json.environments[0]).toEqual({ env: "PREVIEW", fileCount: 0, usedBytes: 0 });
  });

  test("the key never appears in an owner response", async () => {
    await put(previewA, "x", 1);
    const all = JSON.stringify([
      (await own("GET", "/A/storage")).json,
      (await own("GET", "/A/storage/files")).json,
      (await own("POST", "/A/storage/files/url", { key: "x" })).json,
    ]);
    expect(all).not.toContain("tau_st_");
  });

  test("rotating the key: the new one works, the old one has its grace window, the value is never returned", async () => {
    await put(previewA, "keep.txt", 1);
    const res = await own("POST", "/A/storage/rotate-key");
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ rotated: true, previousKeyValidForHours: 24 });
    expect(JSON.stringify(res.json)).not.toContain("tau_st_");
    const active = tables.storageKey.find((k) => k.projectId === PA && k.env === "PREVIEW" && k.status === "ACTIVE")!;
    expect(active.lookupHash).not.toBe(tables.storageKey.find((k) => k.status === "ROTATING")!.lookupHash);
    // The old key still lists during the grace window; live and other projects are untouched.
    expect((await call(previewA, "GET", "/files")).json.files).toHaveLength(1);
    expect(tables.storageKey.filter((k) => k.status === "ACTIVE" && k.projectId === PA)).toHaveLength(2); // preview + live
  });

  test("rotating the live key refreshes the published app, leaves preview alone, and says when it could not", async () => {
    refreshCalls.length = 0;
    refreshOutcome = { status: "refreshed" };
    const previewBefore = tables.storageKey.find((k) => k.projectId === PA && k.env === "PREVIEW" && k.status === "ACTIVE")!.lookupHash;
    const res = await own("POST", "/A/storage/rotate-key", { env: "LIVE" });
    expect(res.json).toEqual({ rotated: true, previousKeyValidForHours: 24, appliedToLiveApp: true });
    expect(refreshCalls).toEqual([PA]);
    expect(tables.storageKey.find((k) => k.projectId === PA && k.env === "PREVIEW" && k.status === "ACTIVE")!.lookupHash).toBe(previewBefore);
    expect(tables.storageKey.filter((k) => k.projectId === PA && k.env === "LIVE" && k.status === "ROTATING")).toHaveLength(1);
    expect((await call(liveA, "GET", "/files")).status).toBe(200); // the old live key, in its grace window

    refreshOutcome = { status: "skipped" }; // a publish is in progress
    expect((await own("POST", "/A/storage/rotate-key", { env: "LIVE" })).json.appliedToLiveApp).toBe(false);
  });

  test("the live key cannot be rotated before the app was ever published with storage", async () => {
    expect((await own("POST", "/B/storage/rotate-key", { env: "LIVE" })).status).toBe(400);
  });

  test("rotating is refused for another user, and for an app that does not use storage", async () => {
    expect((await own("POST", "/C/storage/rotate-key")).status).toBe(404);
    projects.B!.storageEnabled = false;
    expect((await own("POST", "/B/storage/rotate-key")).status).toBe(400);
  });
});

describe("admin storage controls", () => {
  const admin = (method: string, path: string, body?: unknown, who: string | null = "admin-1") =>
    fetch(`${root}/admin${path.replace(/^\/projects\/(A|B|C)\//, (_m, k: string) => `/projects/${ids[k]}/`)}`, {
      method,
      headers: { "Content-Type": "application/json", ...(who ? { "x-test-admin": who } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(async (r) => ({ status: r.status, json: (await r.json()) as any }));

  test("the overview: totals, biggest projects, owners and who is near the allowance", async () => {
    await put(previewA, "a", 1000);
    await put(previewB, "b", 5000);
    for (let i = 0; i < 8; i++) await put(liveA, `big${i}`, 10 * 1024 * 1024); // 80 MB of a 100 MB allowance
    const o = await admin("GET", "/storage");
    expect(o.status).toBe(200);
    expect(o.json.configured).toBe(true);
    expect(o.json.totals).toMatchObject({ files: 10, projects: 2, owners: 1 });
    expect(o.json.totals.usedBytes).toBe(1000 + 5000 + 80 * 1024 * 1024);
    expect(o.json.topProjects[0]).toMatchObject({ projectId: PA, name: null, files: 9 });
    expect(o.json.topOwners[0]).toMatchObject({ userId: "owner", quotaBytes: 100 * 1024 * 1024 });
    expect(o.json.nearAllowance.map((x: any) => x.userId)).toEqual(["owner"]);
    expect(o.json.busiestProject).toEqual({ projectId: PA, uploads: 9 });
  });

  test("an owner under four fifths of the allowance is not listed", async () => {
    await put(previewA, "small", 1000);
    expect((await admin("GET", "/storage")).json.nearAllowance).toEqual([]);
  });

  test("suspend stops the app, keeps the files, and resume restores it", async () => {
    await put(previewA, "keep.txt", 3, "text/plain");
    const s = await admin("POST", "/projects/A/storage/suspend", { reason: "phishing page reported" });
    expect(s.status).toBe(200);
    expect(projects.A!.storageSuspendedAt).toBeInstanceOf(Date);
    expect((await call(previewA, "POST", "/uploads", { key: "n", size: 1 })).json.code).toBe("storage_suspended");
    expect((await call(previewA, "POST", "/files/url", { key: "keep.txt" })).status).toBe(403);
    // The admin can still see what is there.
    const files = await admin("GET", "/projects/A/storage/files");
    expect(files.json.files.map((f: any) => f.key)).toEqual(["keep.txt"]);
    expect((await admin("POST", "/projects/A/storage/resume")).status).toBe(200);
    expect(projects.A!.storageSuspendedAt).toBeNull();
    expect((await call(previewA, "POST", "/files/url", { key: "keep.txt" })).status).toBe(200);
  });

  test("a reason is required to suspend or to delete a file; an unknown project is 404", async () => {
    expect((await admin("POST", "/projects/A/storage/suspend", {})).status).toBe(400);
    expect((await admin("POST", "/projects/A/storage/files/delete", { key: "x" })).status).toBe(400);
    const unknown = await fetch(`${root}/admin/projects/00000000-0000-4000-8000-0000000000ff/storage/suspend`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-admin": "admin-1" },
      body: JSON.stringify({ reason: "x" }),
    });
    expect(unknown.status).toBe(404);
  });

  test("a takedown deletes the file from the app and the bucket, per environment", async () => {
    await put(previewA, "bad.html", 3, "text/html");
    await put(liveA, "bad.html", 3, "text/html");
    const del = await admin("POST", "/projects/A/storage/files/delete", { env: "PREVIEW", key: "bad.html", reason: "malware" });
    expect(del.json.deleted).toBe(1);
    expect((await call(previewA, "GET", "/files")).json.files).toEqual([]);
    expect((await call(liveA, "GET", "/files")).json.files).toHaveLength(1);
    expect(bucket.size).toBe(1);
  });
});

describe("storage alert rules", () => {
  const limits = { uploadsPerHour: 500, bucketBytes: 8 * 1024 ** 3 };
  test("quiet below both limits and at no traffic", () => {
    expect(storageAnomalies({ busiestProject: null, totalBytes: 0 }, limits)).toEqual([]);
    expect(storageAnomalies({ busiestProject: { projectId: "p", uploads: 499 }, totalBytes: 8 * 1024 ** 3 - 1 }, limits)).toEqual([]);
  });
  test("an upload spike names the project; the bucket total names the size; both can fire", () => {
    const spike = storageAnomalies({ busiestProject: { projectId: "p1", uploads: 500 }, totalBytes: 0 }, limits);
    expect(spike.map((a) => a.key)).toEqual(["storage_upload_spike"]);
    expect(spike[0]!.message).toContain("p1");
    const big = storageAnomalies({ busiestProject: null, totalBytes: 9 * 1024 ** 3 }, limits);
    expect(big.map((a) => a.key)).toEqual(["storage_bucket_size"]);
    expect(big[0]!.message).toContain("9 GB");
    expect(storageAnomalies({ busiestProject: { projectId: "p", uploads: 900 }, totalBytes: 9 * 1024 ** 3 }, limits)).toHaveLength(2);
  });
});

describe("reconciling the bucket with the table", () => {
  const row = (id: string, status = "READY", project = PA) => ({ id, projectId: project, env: "PREVIEW" as const, key: id, status: status as "READY" });

  test("diffStorage finds both kinds of orphan and ignores what is in step", () => {
    const rows = [row("ok"), row("gone"), row("pending", "PENDING")];
    const keys = [r2KeyFor(PA, "PREVIEW", "ok"), r2KeyFor(PA, "PREVIEW", "stray"), r2KeyFor(PA, "PREVIEW", "pending")];
    const diff = diffStorage(keys, rows);
    expect(diff.orphanObjects).toEqual([r2KeyFor(PA, "PREVIEW", "stray")]);
    expect(diff.missingObjects.map((r) => r.id)).toEqual(["gone"]); // a PENDING row with no object is normal
  });

  test("an empty bucket and an empty table agree", () => {
    expect(diffStorage([], [])).toEqual({ orphanObjects: [], missingObjects: [] });
  });

  test("report only by default; fix deletes the stray object and the dead row", async () => {
    const real = await put(previewA, "real.txt", 3, "text/plain");
    const ghost = await put(previewA, "ghost.txt", 3, "text/plain");
    bucket.delete(r2KeyFor(PA, "PREVIEW", ghost.json.file.id)); // a READY row whose bytes are gone
    bucket.set(r2KeyFor(PA, "PREVIEW", "stray-object"), 9); // bytes with no row

    const report = await reconcileStorage({ fix: false });
    expect(report.orphanObjects).toEqual([r2KeyFor(PA, "PREVIEW", "stray-object")]);
    expect(report.missingObjects.map((r) => r.key)).toEqual(["ghost.txt"]);
    expect(report.fixed).toBeNull();
    expect(bucket.has(r2KeyFor(PA, "PREVIEW", "stray-object"))).toBe(true); // nothing changed

    const fixed = await reconcileStorage({ fix: true });
    expect(fixed.fixed).toEqual({ objectsDeleted: 1, rowsDeleted: 1 });
    expect(bucket.has(r2KeyFor(PA, "PREVIEW", "stray-object"))).toBe(false);
    expect((await call(previewA, "GET", "/files")).json.files.map((f: any) => f.key)).toEqual(["real.txt"]);
    expect(bucket.has(r2KeyFor(PA, "PREVIEW", real.json.file.id))).toBe(true);
    expect((await reconcileStorage({ fix: false })).orphanObjects).toEqual([]);
  });
});
