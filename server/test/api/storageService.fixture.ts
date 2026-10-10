// Runs in its own process (see storageService.test.ts) because mock.module is global.
// Drives the real routes, middleware and service against an in-memory database
// and bucket.
process.env.TAU_KEY_ENC_SECRET = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
process.env.STORAGE_RPM = "40";

import { beforeEach, afterAll, describe, expect, mock, test } from "bun:test";
import express from "express";

type Row = Record<string, any>;
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
    aggregate: async ({ where }: Row) => ({
      _sum: { sizeBytes: rows.filter((r) => matches(r, where)).reduce((n, r) => n + r.sizeBytes, 0n) },
    }),
  };
}

const fakePrisma: Row = {
  storageObject: table("storageObject"),
  storageKey: table("storageKey"),
  project: { findUnique: async ({ where }: Row) => projects[where.id] ?? null },
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
  deleteStorageObjects: async (keys: string[]) => {
    keys.forEach((k) => bucket.delete(k));
    return [];
  },
}));

const { default: routes } = await import("@/api/routes/storage.routes");
const { __resetStorageLimiter } = await import("@/api/middleware/storageKey.middleware");
const { ensureStorageKey, rotateStorageKey, revokeStorageKeys } = await import("@/lib/storageKeys");
const { sweepStorage } = await import("@/api/services/storage.service");

const app = express();
app.use(express.json());
app.use("/storage", routes);
const server = app.listen(0);
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/storage`;
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
  projects.A = { id: "A", storageSuspendedAt: null };
  projects.B = { id: "B", storageSuspendedAt: null };
  billing.owner = { plan: "FREE" };
  previewA = (await ensureStorageKey("A", "owner", "PREVIEW")).key;
  liveA = (await ensureStorageKey("A", "owner", "LIVE")).key;
  previewB = (await ensureStorageKey("B", "owner", "PREVIEW")).key;
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
    expect(tables.storageObject.at(-1)).toMatchObject({ projectId: "A", env: "PREVIEW" });
  });

  test("a completion id from another project is not found", async () => {
    const up = await call(previewB, "POST", "/uploads", { key: "x", size: 1 });
    expect((await call(previewA, "POST", `/uploads/${up.json.id}/complete`)).status).toBe(404);
  });

  test("a revoked key and a closed grace window are refused; the grace window works", async () => {
    const rotated = await rotateStorageKey("A", "owner", "PREVIEW");
    expect((await call(previewA, "GET", "/files")).status).toBe(200); // old key, inside grace
    expect((await call(rotated.key, "GET", "/files")).status).toBe(200);
    tables.storageKey.find((k) => k.status === "ROTATING")!.revokeAfter = new Date(Date.now() - 1000);
    expect((await call(previewA, "GET", "/files")).status).toBe(401);
    await revokeStorageKeys("A");
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
