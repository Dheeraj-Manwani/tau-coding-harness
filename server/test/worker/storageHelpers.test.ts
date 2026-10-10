import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { StorageError, completeUpload, createUpload, deleteFiles, fileUrls, listFiles, saveFile } from "@/worker/templates/storage/server-storage";
import { UploadError, uploadFile } from "@/worker/templates/storage/upload-file";

// The two files `enable_storage` writes into an app, run for real against a
// stubbed `fetch` and `XMLHttpRequest`. They are also typechecked with the rest
// of the service, so a drift from the /storage API shows up in one of the two.

const realFetch = globalThis.fetch;
let calls: { url: string; init: RequestInit }[];
let reply: (url: string, init: RequestInit) => { status?: number; body: unknown };

beforeEach(() => {
  calls = [];
  process.env.TAU_STORAGE_URL = "https://tau.example/storage/";
  process.env.TAU_STORAGE_KEY = "tau_st_testkey";
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const { status = 200, body } = reply(url, init);
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("server/storage.ts", () => {
  test("calls tau with the key as a bearer token and the right path", async () => {
    reply = () => ({ status: 201, body: { id: "u1", uploadUrl: "https://r2/x", method: "PUT", headers: {}, expiresAt: "" } });
    await createUpload({ key: "a/b.png", contentType: "image/png", size: 3 });
    expect(calls[0]!.url).toBe("https://tau.example/storage/uploads");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer tau_st_testkey");
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ key: "a/b.png", contentType: "image/png", size: 3 });
  });

  test("a failure becomes a StorageError carrying tau's code and status", async () => {
    reply = () => ({ status: 413, body: { error: "Over the allowance.", code: "storage_full" } });
    const err = await createUpload({ key: "a", contentType: "text/plain", size: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(StorageError);
    expect(err).toMatchObject({ code: "storage_full", status: 413, message: "Over the allowance." });
  });

  test("without the environment it says so instead of calling anything", async () => {
    delete process.env.TAU_STORAGE_KEY;
    reply = () => ({ body: {} });
    const err = await listFiles().catch((e) => e);
    expect(err.code).toBe("not_configured");
    expect(calls).toHaveLength(0);
  });

  test("ids and keys are encoded; list builds its query", async () => {
    reply = () => ({ body: { file: {}, files: [], nextCursor: null } });
    await completeUpload("a/b c");
    expect(calls[0]!.url).toBe("https://tau.example/storage/uploads/a%2Fb%20c/complete");
    await listFiles({ prefix: "users/1/", limit: 5 });
    expect(calls[1]!.url).toBe("https://tau.example/storage/files?prefix=users%2F1%2F&limit=5");
    await fileUrls(["a"]);
    await deleteFiles({ prefix: "tmp/" });
    expect(JSON.parse(calls[3]!.init.body as string)).toEqual({ prefix: "tmp/" });
  });

  test("saveFile creates, uploads the exact bytes with the signed headers, and completes", async () => {
    reply = (url) =>
      url.endsWith("/uploads")
        ? { status: 201, body: { id: "u1", uploadUrl: "https://r2/put", method: "PUT", headers: { "Content-Type": "text/csv" }, expiresAt: "" } }
        : url === "https://r2/put"
          ? { body: {} }
          : { body: { file: { id: "u1", key: "export.csv" } } };
    const file = await saveFile("export.csv", "a,b\n", "text/csv");
    expect(file.key).toBe("export.csv");
    expect(JSON.parse(calls[0]!.init.body as string).size).toBe(4);
    expect(calls[1]!.url).toBe("https://r2/put");
    expect(calls[1]!.init.method).toBe("PUT");
    expect((calls[1]!.init.headers as Record<string, string>)["Content-Type"]).toBe("text/csv");
  });

  test("saveFile reports a failed upload", async () => {
    reply = (url) =>
      url.endsWith("/uploads")
        ? { status: 201, body: { id: "u1", uploadUrl: "https://r2/put", method: "PUT", headers: {}, expiresAt: "" } }
        : { status: 403, body: {} };
    expect(await saveFile("x", "y", "text/plain").catch((e) => e)).toMatchObject({ code: "upload_failed" });
  });
});

class FakeXhr {
  static last: FakeXhr;
  static outcome: "ok" | "fail" | "network" = "ok";
  method = "";
  url = "";
  headers: Record<string, string> = {};
  body: unknown;
  status = 0;
  upload: { onprogress?: (e: { lengthComputable: boolean; loaded: number; total: number }) => void } = {};
  onload?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  constructor() {
    FakeXhr.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  abort() {
    this.onabort?.();
  }
  send(body: unknown) {
    this.body = body;
    queueMicrotask(() => {
      this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 });
      this.upload.onprogress?.({ lengthComputable: true, loaded: 10, total: 10 });
      if (FakeXhr.outcome === "network") return this.onerror?.();
      this.status = FakeXhr.outcome === "ok" ? 200 : 403;
      this.onload?.();
    });
  }
}

describe("src/lib/uploadFile.ts", () => {
  const realXhr = (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest;
  beforeEach(() => {
    (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = FakeXhr;
    FakeXhr.outcome = "ok";
  });
  afterEach(() => {
    (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = realXhr;
  });
  const file = new File(["0123456789"], "pic.png", { type: "image/png" });

  test("asks the app's routes, sends the bytes with the signed headers, reports progress, then completes", async () => {
    reply = (url) =>
      url === "/api/files/upload-url"
        ? { body: { id: "u1", uploadUrl: "https://r2/put", headers: { "Content-Type": "image/png" } } }
        : { body: { file: { id: "u1", key: "uploads/x/pic.png", name: "pic.png" } } };
    const seen: number[] = [];
    const out = await uploadFile(file, { onProgress: (f) => seen.push(f), extra: { recordId: 7 } });
    expect(out.name).toBe("pic.png");
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ name: "pic.png", contentType: "image/png", size: 10, recordId: 7 });
    expect(FakeXhr.last).toMatchObject({ method: "PUT", url: "https://r2/put", headers: { "Content-Type": "image/png" } });
    expect(FakeXhr.last.body).toBe(file);
    expect(seen).toEqual([0.5, 1]);
    expect(calls[1]!.url).toBe("/api/files/complete");
  });

  test("tau's refusal reaches the caller with its code", async () => {
    reply = () => ({ status: 413, body: { error: "Files can be at most 10 MB on this plan.", code: "file_too_large" } });
    const err = await uploadFile(file).catch((e) => e);
    expect(err).toBeInstanceOf(UploadError);
    expect(err).toMatchObject({ code: "file_too_large", message: "Files can be at most 10 MB on this plan." });
  });

  test("a failed or dropped PUT is an UploadError and never calls complete", async () => {
    reply = () => ({ body: { id: "u1", uploadUrl: "https://r2/put", headers: {} } });
    for (const outcome of ["fail", "network"] as const) {
      FakeXhr.outcome = outcome;
      calls = [];
      expect(await uploadFile(file).catch((e) => e)).toBeInstanceOf(UploadError);
      expect(calls).toHaveLength(1);
    }
  });

  test("an unnamed type is sent as octet-stream", async () => {
    reply = () => ({ body: { id: "u1", uploadUrl: "https://r2/put", headers: {}, file: {} } });
    await uploadFile(new File(["x"], "blob"));
    expect(JSON.parse(calls[0]!.init.body as string).contentType).toBe("application/octet-stream");
  });
});
