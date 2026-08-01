import { describe, expect, mock, test } from "bun:test";
import http from "node:http";
import type { AddressInfo } from "node:net";

// The site handler is the one public, unauthenticated surface tau exposes, and
// its behaviour is mostly in the *routing* — Express 5 wildcards, the SPA
// fallback, which requests are allowed to fall back at all. That is not
// testable by calling the helpers, so this drives the real router over real
// HTTP with only the two I/O edges (R2, the slug lookup) stubbed.

const objects = new Map<string, string>();
let lookup: { storagePrefix: string } | null = null;

const realS3 = await import("@/lib/s3");
mock.module("@/lib/s3", () => ({
  ...realS3,
  getSiteObject: async (key: string) => {
    const body = objects.get(key);
    if (body === undefined) return null;
    return {
      body: new TextEncoder().encode(body),
      contentType: "text/html; charset=utf-8",
      etag: `"${key}"`,
    };
  },
}));

mock.module("@/api/lib/siteLookup", () => ({
  resolveLiveSite: async () => lookup,
  invalidateSiteLookup: () => {},
}));

const express = (await import("express")).default;
const siteRoutes = (await import("@/api/routes/sites.routes")).default;

const app = express();
app.use(siteRoutes);
const server = http.createServer(app).listen(0);
const port = (server.address() as AddressInfo).port;

const get = async (
  path: string,
  headers: Record<string, string> = {},
): Promise<Response> =>
  fetch(`http://127.0.0.1:${port}${path}`, { headers, redirect: "manual" });

const PREFIX = "tau/sites/u1/p1/d1";

function publish(files: Record<string, string>): void {
  objects.clear();
  for (const [path, body] of Object.entries(files)) {
    objects.set(`${PREFIX}/${path}`, body);
  }
  lookup = { storagePrefix: PREFIX };
}

describe("published site serving", () => {
  test("the root serves index.html", async () => {
    publish({ "index.html": "<h1>hello</h1>" });

    const res = await get("/sites/my-app/");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<h1>hello</h1>");
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  // Without this, relative asset URLs in the HTML would resolve against
  // /sites/ and every bundle would 404.
  test("no trailing slash redirects to one", async () => {
    publish({ "index.html": "<h1>hello</h1>" });

    const res = await get("/sites/my-app");
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("/sites/my-app/");
  });

  test("nested assets are served", async () => {
    publish({
      "index.html": "<h1>hello</h1>",
      "assets/index-a1b2c3d4.js": "console.log(1)",
    });

    const res = await get("/sites/my-app/assets/index-a1b2c3d4.js");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("console.log(1)");
    expect(res.headers.get("cache-control")).toContain("immutable");
  });

  test("a client-side route falls back to index.html", async () => {
    publish({ "index.html": "<h1>hello</h1>" });

    const res = await get("/sites/my-app/settings/profile");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<h1>hello</h1>");
  });

  // Returning HTML for a missing .js turns a broken build into an unreadable
  // MIME error in the console instead of an honest 404.
  test("a missing asset 404s rather than falling back", async () => {
    publish({ "index.html": "<h1>hello</h1>" });

    const res = await get("/sites/my-app/assets/missing.js");
    expect(res.status).toBe(404);
  });

  test("an unpublished slug 404s", async () => {
    publish({ "index.html": "<h1>hello</h1>" });
    lookup = null;

    const res = await get("/sites/nobody-here/");
    expect(res.status).toBe(404);
  });

  test("an invalid slug 404s without touching storage", async () => {
    publish({ "index.html": "<h1>hello</h1>" });

    const res = await get("/sites/Bad_Slug/");
    expect(res.status).toBe(404);
  });

  test("traversal cannot escape the deployment prefix", async () => {
    publish({ "index.html": "<h1>hello</h1>" });
    objects.set("tau/sites/u1/p1/d2/secret.js", "SECRET");

    const res = await get("/sites/my-app/../d2/secret.js");
    expect(await res.text()).not.toContain("SECRET");
  });

  test("hardening headers are set", async () => {
    publish({ "index.html": "<h1>hello</h1>" });

    const res = await get("/sites/my-app/");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  });

  test("a matching If-None-Match gets a 304", async () => {
    publish({ "index.html": "<h1>hello</h1>" });

    const first = await get("/sites/my-app/");
    const etag = first.headers.get("etag")!;
    expect(etag).toBeTruthy();

    const second = await get("/sites/my-app/", { "if-none-match": etag });
    expect(second.status).toBe(304);
  });
});
