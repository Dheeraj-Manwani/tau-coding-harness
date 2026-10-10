import { beforeEach, describe, expect, test } from "bun:test";
import worker from "../src/index";
import { BADGE_SOURCE } from "../src/badgeSource";
import { handle, prefixAllowed, redirectLocation, type Env, type RoutingRecord } from "../src/serve";

// The router against stand-ins for R2 and KV. Every rule here has a twin in
// server/test/api/siteServing.test.ts: the two serve the same sites.

const PREFIX = "tau/sites/u1/p1/d1";
const HOST = "my-app.bytauai.pro";

const objects = new Map<string, { body: string; contentType?: string }>();
const records = new Map<string, unknown>();
const reads: string[] = [];
let kvReads = 0;

function fakeObject(key: string, entry: { body: string; contentType?: string }) {
  return {
    key,
    httpEtag: `"${key}"`,
    httpMetadata: entry.contentType ? { contentType: entry.contentType } : undefined,
    body: new Blob([entry.body]).stream(),
    text: async () => entry.body,
  };
}

const env: Env = {
  R2_BUCKET: {
    get: async (key: string) => {
      reads.push(key);
      const entry = objects.get(key);
      return entry ? fakeObject(key, entry) : null;
    },
  } as unknown as R2Bucket,
  ROUTES: {
    get: async (key: string) => {
      kvReads += 1;
      return records.get(key) ?? null;
    },
  } as unknown as KVNamespace,
  LANDING_URL: "https://tauai.pro",
  APP_URL: "https://app.tauai.pro",
};

function publish(
  files: Record<string, string>,
  over: Partial<RoutingRecord> = {},
  host = HOST,
): void {
  objects.clear();
  for (const [path, body] of Object.entries(files)) objects.set(`${PREFIX}/${path}`, { body });
  records.set(`host:${host}`, {
    projectId: "p1",
    slug: host.split(".")[0],
    prefix: PREFIX,
    showBadge: false,
    suspended: false,
    redirectTo: null,
    ...over,
  });
}

const get = (path: string, init: RequestInit & { host?: string } = {}) =>
  handle(new Request(`https://${init.host ?? HOST}${path}`, init), env);

beforeEach(() => {
  objects.clear();
  records.clear();
  reads.length = 0;
  kvReads = 0;
});

describe("serving a published site", () => {
  test("the root serves index.html", async () => {
    publish({ "index.html": "<h1>hello</h1>" });

    const res = await get("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<h1>hello</h1>");
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  test("nested assets are served, fingerprinted ones as immutable", async () => {
    publish({ "index.html": "x", "assets/index-a1b2c3d4.js": "console.log(1)" });

    const res = await get("/assets/index-a1b2c3d4.js");
    expect(await res.text()).toBe("console.log(1)");
    expect(res.headers.get("cache-control")).toContain("immutable");
    expect(res.headers.get("content-type")).toContain("text/javascript");
  });

  test("the object's own content type wins, with the extension as the fallback", async () => {
    publish({ "index.html": "x" });
    objects.set(`${PREFIX}/data.json`, { body: "{}", contentType: "application/json; charset=utf-8" });
    objects.set(`${PREFIX}/logo.png`, { body: "png" });

    expect((await get("/data.json")).headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect((await get("/logo.png")).headers.get("content-type")).toBe("image/png");
  });

  test("a client-side route falls back to index.html", async () => {
    publish({ "index.html": "<h1>hello</h1>" });
    expect(await (await get("/settings/profile")).text()).toBe("<h1>hello</h1>");
  });

  test("a missing asset 404s rather than falling back", async () => {
    publish({ "index.html": "<h1>hello</h1>" });
    expect((await get("/assets/missing.js")).status).toBe(404);
  });

  test("traversal cannot escape the deployment prefix", async () => {
    publish({ "index.html": "<h1>hello</h1>" });
    objects.set("tau/sites/u1/p1/d2/secret.js", { body: "SECRET" });
    objects.set("tau/project-files/u1/p1/abc", { body: "SOURCE" });

    for (const path of ["/../d2/secret.js", "/%2e%2e/d2/secret.js", "/..%2f..%2fproject-files/u1/p1/abc"]) {
      const res = await get(path);
      const text = await res.text();
      expect(text).not.toContain("SECRET");
      expect(text).not.toContain("SOURCE");
    }
    expect(reads.every((k) => k.startsWith(`${PREFIX}/`))).toBe(true);
  });

  test("hardening headers are set", async () => {
    publish({ "index.html": "x" });
    const res = await get("/");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  });

  test("a matching If-None-Match gets a 304", async () => {
    publish({ "index.html": "x" });
    const etag = (await get("/")).headers.get("etag")!;
    expect(etag).toBeTruthy();
    expect((await get("/", { headers: { "if-none-match": etag } })).status).toBe(304);
  });

  test("HEAD answers with headers and no body", async () => {
    publish({ "index.html": "<h1>hello</h1>" });
    const res = await get("/", { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toBe("");
  });

  test("anything but GET and HEAD is refused", async () => {
    publish({ "index.html": "x" });
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
      const res = await get("/", { method });
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("GET, HEAD");
    }
    expect(kvReads).toBe(0);
  });
});

describe("which site a request is for", () => {
  test("an unknown host is 404 and touches no storage", async () => {
    publish({ "index.html": "x" });
    const res = await get("/", { host: "nobody-here.bytauai.pro" });
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("No app is published at this address yet.");
    expect(reads).toHaveLength(0);
  });

  test("two sites are two prefixes, and a host never reaches another's files", async () => {
    publish({ "index.html": "<h1>one</h1>" });
    objects.set("tau/sites/u2/p2/d9/index.html", { body: "<h1>two</h1>" });
    records.set("host:other.bytauai.pro", { projectId: "p2", slug: "other", prefix: "tau/sites/u2/p2/d9", showBadge: false, suspended: false });

    expect(await (await get("/")).text()).toBe("<h1>one</h1>");
    expect(await (await get("/", { host: "other.bytauai.pro" })).text()).toBe("<h1>two</h1>");
  });

  test("the host is case-insensitive and a trailing dot is ignored", async () => {
    publish({ "index.html": "x" });
    expect((await get("/", { host: "MY-APP.bytauai.pro" })).status).toBe(200);
  });

  // The prefix is the one thing a visitor must never influence, and the R2
  // binding reaches the whole bucket, which also holds project source.
  test("a record whose prefix is outside tau/sites/ is never read", async () => {
    for (const prefix of ["tau/project-files/u1/p1", "tau/sites", "tau/sites/", "tau/sites/../project-files/u1", "", "/tau/sites/u1/p1/d1", "tau/sites/u1//d1"]) {
      reads.length = 0;
      objects.set(`${prefix}/index.html`, { body: "SOURCE" });
      records.set(`host:${HOST}`, { projectId: "p1", slug: "my-app", prefix, showBadge: false, suspended: false });

      const res = await get("/");
      expect(res.status).toBe(404);
      expect(await res.text()).not.toContain("SOURCE");
      expect(reads).toHaveLength(0);
    }
  });

  test("prefixAllowed", () => {
    expect(prefixAllowed("tau/sites/u1/p1/d1")).toBe(true);
    expect(prefixAllowed("tau/sites/u1/p1/d1/")).toBe(false);
    expect(prefixAllowed("tau/sites/u1/./d1")).toBe(false);
    expect(prefixAllowed("tau/siteshack/u1")).toBe(false);
  });

  test("a malformed record is the same as no record", async () => {
    for (const bad of ["a string", 12, [], {}, { prefix: 5, slug: "x" }, { prefix: PREFIX }, null]) {
      records.set(`host:${HOST}`, bad);
      expect((await get("/")).status).toBe(404);
    }
    records.set(`host:${HOST}`, { projectId: "p1", slug: "Not_A_Slug", prefix: PREFIX });
    expect((await get("/")).status).toBe(404);
  });

  test("an unknown field in the record is ignored", async () => {
    publish({ "index.html": "x" }, { backend: "https://example.invalid" } as never);
    expect((await get("/")).status).toBe(200);
  });
});

describe("a suspended site", () => {
  test("every path answers 403 with the suspended page, and no file is read", async () => {
    publish({ "index.html": "<h1>hello</h1>", "assets/index-a1b2c3d4.js": "console.log(1)" }, { suspended: true });

    for (const path of ["/", "/settings", "/assets/index-a1b2c3d4.js"]) {
      const res = await get(path);
      expect(res.status).toBe(403);
      const body = await res.text();
      expect(body).toContain("This site has been suspended");
      expect(body).not.toContain("hello");
    }
    expect(reads).toHaveLength(0);
  });

  test("the suspended page is never cached", async () => {
    publish({ "index.html": "x" }, { suspended: true });
    expect((await get("/")).headers.get("cache-control")).toBe("no-store");
  });
});

describe("the Built with tau badge", () => {
  const PAGE = "<html><body><div id=root></div></body></html>";

  test("a free owner's page gets the badge script before </body>", async () => {
    publish({ "index.html": PAGE }, { showBadge: true });

    const html = await (await get("/")).text();
    expect(html).toMatch(/<script src="\/_tau\/badge\.js\?v=[0-9a-f]{12}" defer data-mode="site"/);
    expect(html).toContain('data-site="my-app"');
    expect(html).toContain('data-home="https://tauai.pro"');
    expect(html).toContain('data-upgrade="https://app.tauai.pro/billing"');
    expect(html.indexOf("/_tau/badge.js")).toBeLessThan(html.indexOf("</body>"));
  });

  test("the SPA fallback gets it too", async () => {
    publish({ "index.html": PAGE }, { showBadge: true });
    expect(await (await get("/settings")).text()).toContain("/_tau/badge.js");
  });

  test("a Pro owner's page is served byte for byte", async () => {
    publish({ "index.html": PAGE }, { showBadge: false });
    expect(await (await get("/")).text()).toBe(PAGE);
  });

  test("non-HTML files are never touched", async () => {
    publish({ "index.html": PAGE, "assets/index-a1b2c3d4.js": "console.log(1)" }, { showBadge: true });
    expect(await (await get("/assets/index-a1b2c3d4.js")).text()).toBe("console.log(1)");
  });

  test("the ETag differs with and without the badge", async () => {
    publish({ "index.html": PAGE }, { showBadge: false });
    const plain = (await get("/")).headers.get("etag")!;

    publish({ "index.html": PAGE }, { showBadge: true });
    const badged = await get("/", { headers: { "if-none-match": plain } });
    expect(badged.status).toBe(200);
    expect(badged.headers.get("etag")).not.toBe(plain);
    expect((await get("/", { headers: { "if-none-match": badged.headers.get("etag")! } })).status).toBe(304);
  });

  test("the script is served as JavaScript, from the generated copy", async () => {
    const res = await get("/_tau/badge.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/javascript");
    expect(await res.text()).toBe(BADGE_SOURCE);
    expect(BADGE_SOURCE).toContain("Built with tau");
  });

  test("only the current version of the script is cached long-term", async () => {
    publish({ "index.html": PAGE }, { showBadge: true });
    const src = /src="([^"]+)"/.exec(await (await get("/")).text())![1]!;

    expect((await get(src)).headers.get("cache-control")).toContain("immutable");
    expect((await get("/_tau/badge.js?v=000000000000")).headers.get("cache-control")).toContain("must-revalidate");
  });

  // An app cannot shadow it with a file of its own at the same path, and it
  // needs no record: it is the same on every site.
  test("the script path is answered before the record is read", async () => {
    publish({ "index.html": "x", "_tau/badge.js": "EVIL" });
    expect(await (await get("/_tau/badge.js")).text()).toBe(BADGE_SOURCE);
    const before = kvReads;
    await get("/_tau/badge.js", { host: "nobody.bytauai.pro" });
    expect(kvReads).toBe(before);
  });

  test("the script honours If-None-Match", async () => {
    const etag = (await get("/_tau/badge.js")).headers.get("etag")!;
    expect((await get("/_tau/badge.js", { headers: { "if-none-match": etag } })).status).toBe(304);
  });
});

describe("the Worker's entry point", () => {
  test("turns a storage failure into a plain 503, not a stack trace", async () => {
    const broken: Env = {
      ...env,
      ROUTES: { get: async () => { throw new Error("KV is down: secret detail"); } } as unknown as KVNamespace,
    };
    const res = await worker.fetch(new Request(`https://${HOST}/`), broken);
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("30");
    expect(await res.text()).not.toContain("secret detail");
  });
});

describe("a custom domain", () => {
  test("is served from its own hostname with the same record", async () => {
    publish({ "index.html": "<h1>hello</h1>" }, {}, "www.example.com");

    const res = await get("/", { host: "www.example.com" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<h1>hello</h1>");
  });

  test("the badge reports the app's own name, not the hostname", async () => {
    publish({ "index.html": "<body></body>" }, { showBadge: true, slug: "my-app" }, "www.example.com");
    expect(await (await get("/", { host: "www.example.com" })).text()).toContain('data-site="my-app"');
  });

  test("a hostname with no record is 404, whatever it looks like", async () => {
    publish({ "index.html": "x" });
    for (const host of ["www.example.com", "bytauai.pro", "evil.com"]) {
      expect((await get("/", { host })).status).toBe(404);
    }
  });
});

describe("the primary redirect", () => {
  test("the default address sends everything to the primary domain, path and query kept", async () => {
    publish({ "index.html": "x" }, { redirectTo: "https://www.example.com" });

    const res = await get("/settings/profile?tab=2");
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("https://www.example.com/settings/profile?tab=2");
    expect(await res.text()).toBe("");
    expect(reads).toHaveLength(0);
  });

  test("assets are redirected too, not served from the old address", async () => {
    publish({ "index.html": "x", "assets/index-a1b2c3d4.js": "x" }, { redirectTo: "https://www.example.com" });
    expect((await get("/assets/index-a1b2c3d4.js")).status).toBe(308);
  });

  test("a suspended site is never redirected away from its suspended page", async () => {
    publish({ "index.html": "x" }, { suspended: true, redirectTo: "https://www.example.com" });
    expect((await get("/")).status).toBe(403);
  });

  test("the badge script is still answered here", async () => {
    publish({ "index.html": "x" }, { redirectTo: "https://www.example.com" });
    expect((await get("/_tau/badge.js")).status).toBe(200);
  });

  test("a redirect that would loop, or leave https, is ignored", async () => {
    publish({ "index.html": "<h1>served</h1>" }, { redirectTo: `https://${HOST}` });
    expect(await (await get("/")).text()).toBe("<h1>served</h1>");

    publish({ "index.html": "<h1>served</h1>" }, { redirectTo: "http://www.example.com" });
    expect((await get("/")).status).toBe(200);

    publish({ "index.html": "<h1>served</h1>" }, { redirectTo: "not a url" });
    expect((await get("/")).status).toBe(200);
  });

  test("redirectLocation", () => {
    const at = (url: string) => new URL(`https://${HOST}${url}`);
    expect(redirectLocation(null, at("/"))).toBeNull();
    expect(redirectLocation("https://www.example.com", at("/a?b=1"))).toBe("https://www.example.com/a?b=1");
    expect(redirectLocation("https://www.example.com/ignored/path", at("/x"))).toBe("https://www.example.com/x");
    expect(redirectLocation("https://WWW.example.com:8443", at("/"))).toBe("https://www.example.com:8443/");
    expect(redirectLocation(`https://${HOST.toUpperCase()}`, at("/"))).toBeNull();
  });
});

describe("the API rate limits", () => {
  const record: RoutingRecord = {
    projectId: "p1",
    slug: "my-app",
    prefix: PREFIX,
    showBadge: false,
    suspended: false,
    redirectTo: null,
    api: { url: "https://abc123.lambda-url.us-east-1.on.aws" },
  };
  const forwarded: string[] = [];
  const deps = {
    fetcher: async (input: RequestInfo | URL) => {
      forwarded.push(String(input));
      return new Response("{}", { status: 200 });
    },
  };
  const limiter = (log: string[], deny: (key: string) => boolean) => ({
    limit: async ({ key }: { key: string }) => {
      log.push(key);
      return { success: !deny(key) };
    },
  });
  const call = (e: Env, ip = "203.0.113.9") => {
    records.set(`host:${HOST}`, record);
    return handle(new Request(`https://${HOST}/api/items`, { headers: { "cf-connecting-ip": ip } }), { ...e, AWS_ACCESS_KEY_ID: "k", AWS_SECRET_ACCESS_KEY: "s" }, deps);
  };

  beforeEach(() => {
    forwarded.length = 0;
  });

  test("no limiter configured means no limit", async () => {
    expect((await call(env)).status).toBe(200);
  });

  test("a visitor over the per-address limit gets 429 and nothing reaches the backend", async () => {
    const keys: string[] = [];
    const res = await call({ ...env, API_IP_LIMITER: limiter(keys, () => true) });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(keys).toEqual(["p1:203.0.113.9"]);
    expect(forwarded).toEqual([]);
  });

  test("the app-wide limit applies to every visitor", async () => {
    const res = await call({ ...env, API_APP_LIMITER: limiter([], () => true) }, "198.51.100.7");
    expect(res.status).toBe(429);
    expect(forwarded).toEqual([]);
  });

  test("the limit is per app and address: one visitor over does not stop another", async () => {
    const e = { ...env, API_IP_LIMITER: limiter([], (k) => k.endsWith(":203.0.113.9")) };
    expect((await call(e, "203.0.113.9")).status).toBe(429);
    expect((await call(e, "198.51.100.7")).status).toBe(200);
  });

  test("a limiter that fails does not take the app down", async () => {
    const broken = { limit: async () => { throw new Error("down"); } };
    expect((await call({ ...env, API_IP_LIMITER: broken, API_APP_LIMITER: broken })).status).toBe(200);
  });

  test("static files are never counted", async () => {
    const keys: string[] = [];
    publish({ "index.html": "<h1>hi</h1>" });
    const res = await handle(new Request(`https://${HOST}/`), { ...env, API_IP_LIMITER: limiter(keys, () => true) });
    expect(res.status).toBe(200);
    expect(keys).toEqual([]);
  });
});
