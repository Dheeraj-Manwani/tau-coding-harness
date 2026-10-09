import { afterEach, describe, expect, mock, test } from "bun:test";
import http from "node:http";
import type { AddressInfo } from "node:net";

// The site handler is the one public, unauthenticated surface tau exposes, and
// its behaviour is mostly in the *routing* — Express 5 wildcards, the SPA
// fallback, which requests are allowed to fall back at all. That is not
// testable by calling the helpers, so this drives the real router over real
// HTTP with only the two I/O edges (R2, the slug lookup) stubbed.

const objects = new Map<string, string>();
let lookup:
  | { state: "live"; storagePrefix: string; showBadge: boolean }
  | { state: "suspended" }
  | null = null;

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
  resolveSite: async () => lookup,
  invalidateSiteLookup: () => {},
}));

const { env } = await import("@/lib/env");
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

function publish(
  files: Record<string, string>,
  { showBadge = false }: { showBadge?: boolean } = {},
): void {
  objects.clear();
  for (const [path, body] of Object.entries(files)) {
    objects.set(`${PREFIX}/${path}`, body);
  }
  lookup = { state: "live", storagePrefix: PREFIX, showBadge };
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

describe("a suspended site", () => {
  test("every path answers 403 with the suspended page", async () => {
    publish({
      "index.html": "<h1>hello</h1>",
      "assets/index-a1b2c3d4.js": "console.log(1)",
    });
    lookup = { state: "suspended" };

    for (const path of ["/", "/settings", "/assets/index-a1b2c3d4.js"]) {
      const res = await get(`/sites/my-app${path}`);
      expect(res.status).toBe(403);
      const body = await res.text();
      expect(body).toContain("This site has been suspended");
      expect(body).not.toContain("hello");
      expect(body).not.toContain("console.log");
    }
  });

  // A browser or proxy that kept the page would go on showing "suspended"
  // after the suspension was lifted.
  test("the suspended page is never cached", async () => {
    lookup = { state: "suspended" };

    const res = await get("/sites/my-app/");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("SITES_PATH_MODE=redirect", () => {
  const original = {
    mode: env.SITES_PATH_MODE,
    domain: env.SITES_DOMAIN,
  };
  const set = (mode: "serve" | "redirect", domain: string | undefined) => {
    env.SITES_PATH_MODE = mode;
    env.SITES_DOMAIN = domain;
  };
  afterEach(() => set(original.mode, original.domain));

  test("the path form redirects to the subdomain, path preserved", async () => {
    publish({ "index.html": "<h1>hello</h1>" });
    set("redirect", "usetau.app");

    const asset = await get("/sites/my-app/assets/index-a1b2c3d4.js?v=2");
    expect(asset.status).toBe(308);
    expect(asset.headers.get("location")).toBe(
      "https://my-app.usetau.app/assets/index-a1b2c3d4.js?v=2",
    );

    const root = await get("/sites/my-app/");
    expect(root.status).toBe(308);
    expect(root.headers.get("location")).toBe("https://my-app.usetau.app/");

    const bare = await get("/sites/my-app");
    expect(bare.status).toBe(308);
    expect(bare.headers.get("location")).toBe("https://my-app.usetau.app/");
  });

  // Nothing of the app is served from this origin in redirect mode, whatever
  // state the site is in: the subdomain answers for it.
  test("it redirects without reading the site", async () => {
    lookup = null;
    set("redirect", "usetau.app");

    const res = await get("/sites/not-published/");
    expect(res.status).toBe(308);
  });

  test("without a sites domain the path form is still served", async () => {
    publish({ "index.html": "<h1>hello</h1>" });
    set("redirect", undefined);

    const res = await get("/sites/my-app/");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<h1>hello</h1>");
  });

  test("serve mode is unchanged with a sites domain set", async () => {
    publish({ "index.html": "<h1>hello</h1>" });
    set("serve", "usetau.app");

    const res = await get("/sites/my-app/");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<h1>hello</h1>");

    const bare = await get("/sites/my-app");
    expect(bare.headers.get("location")).toBe("/sites/my-app/");
  });
});

describe("the Built with tau badge", () => {
  const PAGE = "<html><body><div id=root></div></body></html>";

  test("a free owner's page gets the badge script before </body>", async () => {
    publish({ "index.html": PAGE }, { showBadge: true });

    const html = await (await get("/sites/my-app/")).text();
    expect(html).toMatch(
      /<script src="\/_tau\/badge\.js\?v=[0-9a-f]{12}" defer data-mode="site"/,
    );
    expect(html).toContain('data-site="my-app"');
    expect(html.indexOf("/_tau/badge.js")).toBeLessThan(html.indexOf("</body>"));
  });

  test("the SPA fallback gets it too", async () => {
    publish({ "index.html": PAGE }, { showBadge: true });

    const html = await (await get("/sites/my-app/settings")).text();
    expect(html).toContain("/_tau/badge.js");
  });

  test("a Pro owner's page is served byte for byte", async () => {
    publish({ "index.html": PAGE }, { showBadge: false });

    expect(await (await get("/sites/my-app/")).text()).toBe(PAGE);
  });

  test("non-HTML files are never touched", async () => {
    publish(
      { "index.html": PAGE, "assets/index-a1b2c3d4.js": "console.log(1)" },
      { showBadge: true },
    );

    const res = await get("/sites/my-app/assets/index-a1b2c3d4.js");
    expect(await res.text()).toBe("console.log(1)");
  });

  // An upgrade or downgrade changes the bytes, so a browser's cached copy from
  // before it must not be revalidated as still fresh.
  test("the ETag differs with and without the badge", async () => {
    publish({ "index.html": PAGE }, { showBadge: false });
    const plain = (await get("/sites/my-app/")).headers.get("etag")!;

    publish({ "index.html": PAGE }, { showBadge: true });
    const badged = await get("/sites/my-app/", { "if-none-match": plain });
    expect(badged.status).toBe(200);
    expect(badged.headers.get("etag")).not.toBe(plain);

    const again = await get("/sites/my-app/", {
      "if-none-match": badged.headers.get("etag")!,
    });
    expect(again.status).toBe(304);
  });

  test("the script itself is served as JavaScript", async () => {
    const res = await get("/_tau/badge.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/javascript");
    expect(await res.text()).toContain("Built with tau");
  });

  // The page names the exact version, so that URL can be cached forever; any
  // other URL must revalidate, or a browser could keep an old badge for good.
  test("only the current version of the script is cached long-term", async () => {
    publish({ "index.html": PAGE }, { showBadge: true });
    const html = await (await get("/sites/my-app/")).text();
    const src = /src="([^"]+)"/.exec(html)![1]!;

    const current = await get(src);
    expect(current.headers.get("cache-control")).toContain("immutable");

    const stale = await get("/_tau/badge.js?v=000000000000");
    expect(stale.headers.get("cache-control")).toContain("must-revalidate");
  });
});
