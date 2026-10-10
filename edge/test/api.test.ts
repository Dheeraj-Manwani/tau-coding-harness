import { beforeEach, describe, expect, test } from "bun:test";
import {
  API_TIMEOUT_MS,
  MAX_API_BODY_BYTES,
  downstreamHeaders,
  forwardToBackend,
  isApiPath,
  parseApiUrl,
  upstreamHeaders,
} from "../src/api";
import { handle, type Env, type RoutingRecord } from "../src/serve";

// /api/* on a published app: signed, forwarded, streamed back, never cached,
// and with nothing a visitor sends able to pose as the router or as AWS.

const URL_OK = "https://abcdefghij.lambda-url.eu-west-1.on.aws";
const CREDS = { AWS_ACCESS_KEY_ID: "AKIDEXAMPLE", AWS_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY" };

describe("which backend addresses are accepted", () => {
  test("a Lambda function URL, in any region, and its region", () => {
    expect(parseApiUrl(URL_OK)).toEqual({ origin: URL_OK, region: "eu-west-1" });
    expect(parseApiUrl(`${URL_OK}/`)).toEqual({ origin: URL_OK, region: "eu-west-1" });
    expect(parseApiUrl("https://x1y2z3.lambda-url.us-east-2.on.aws")?.region).toBe("us-east-2");
    expect(parseApiUrl("HTTPS://ABC.LAMBDA-URL.AP-SOUTH-1.ON.AWS")?.region).toBe("ap-south-1");
  });

  // A signed request must never go anywhere but a function URL, whatever a record says.
  test("anything else is refused", () => {
    for (const bad of [
      null,
      undefined,
      "",
      "not a url",
      "http://abc.lambda-url.eu-west-1.on.aws",
      "https://evil.example.com",
      "https://abc.lambda-url.eu-west-1.on.aws.evil.com",
      "https://evil.com/abc.lambda-url.eu-west-1.on.aws",
      "https://a.b.lambda-url.eu-west-1.on.aws",
      "https://lambda-url.eu-west-1.on.aws",
      "https://abc.lambda-url.eu-west-1.on.aws:8443",
      "https://user:pw@abc.lambda-url.eu-west-1.on.aws",
      "https://abc.lambda-url.eu-west-1.on.aws/some/path",
      "https://abc.lambda-url.eu-west-1.on.aws/?x=1",
      "https://169.254.169.254",
      "https://abc.execute-api.eu-west-1.amazonaws.com",
    ]) {
      expect(parseApiUrl(bad as string)).toBeNull();
    }
  });

  test("what counts as the API", () => {
    expect(isApiPath("/api")).toBe(true);
    expect(isApiPath("/api/")).toBe(true);
    expect(isApiPath("/api/items/1")).toBe(true);
    expect(isApiPath("/apiary")).toBe(false);
    expect(isApiPath("/api-docs")).toBe(false);
    expect(isApiPath("/")).toBe(false);
    expect(isApiPath("/x/api/y")).toBe(false);
  });
});

describe("the headers sent to the function", () => {
  const sent = (init: Record<string, string>, ip: string | null = "203.0.113.9") =>
    upstreamHeaders(new Headers(init), "my-app.bytauai.pro", ip);

  test("anything a visitor sends that speaks for AWS or the router is removed", () => {
    const out = sent({
      "x-amz-security-token": "stolen",
      "x-amz-date": "20200101T000000Z",
      "x-amzn-trace-id": "Root=1",
      "x-tau-project": "other-project",
      "x-tau-authorization": "Bearer forged",
      "x-forwarded-host": "evil.com",
      "x-forwarded-for": "1.1.1.1",
      "x-forwarded-proto": "http",
      "x-real-ip": "1.1.1.1",
      forwarded: "for=1.1.1.1",
      via: "1.1 evil",
      "true-client-ip": "1.1.1.1",
      "cf-connecting-ip": "203.0.113.9",
      "cf-ray": "abc",
      "cf-worker": "x",
    });

    for (const name of ["x-amz-security-token", "x-amz-date", "x-amzn-trace-id", "x-tau-project", "x-real-ip", "forwarded", "via", "true-client-ip", "cf-connecting-ip", "cf-ray", "cf-worker"]) {
      expect(out.has(name)).toBe(false);
    }
    expect(out.get("x-forwarded-host")).toBe("my-app.bytauai.pro");
    expect(out.get("x-forwarded-proto")).toBe("https");
    expect(out.get("x-forwarded-for")).toBe("203.0.113.9");
    // A forged x-tau-authorization is gone, and nothing replaced it.
    expect(out.has("x-tau-authorization")).toBe(false);
  });

  test("the visitor's own Authorization travels as x-tau-authorization, and is not sent as itself", () => {
    const out = sent({ authorization: "Bearer app-token", "x-tau-authorization": "Bearer forged" });
    expect(out.has("authorization")).toBe(false);
    expect(out.get("x-tau-authorization")).toBe("Bearer app-token");
  });

  test("ordinary headers pass through, cookies included", () => {
    const out = sent({ cookie: "a=1; b=2", "content-type": "application/json", accept: "text/event-stream", "user-agent": "x", "x-custom": "yes" });
    expect(out.get("cookie")).toBe("a=1; b=2");
    expect(out.get("content-type")).toBe("application/json");
    expect(out.get("accept")).toBe("text/event-stream");
    expect(out.get("x-custom")).toBe("yes");
  });

  test("connection-level headers are dropped", () => {
    const out = sent({ host: "my-app.bytauai.pro", connection: "keep-alive", "transfer-encoding": "chunked", "content-length": "5", expect: "100-continue", te: "trailers" });
    for (const name of ["host", "connection", "transfer-encoding", "content-length", "expect", "te"]) expect(out.has(name)).toBe(false);
  });

  test("without a client address no x-forwarded-for is made up", () => {
    expect(sent({}, null).has("x-forwarded-for")).toBe(false);
  });
});

describe("the headers sent back", () => {
  test("AWS's are removed, the app's are kept, and nothing is cached unless the app says so", () => {
    const out = downstreamHeaders(new Headers({ "x-amzn-requestid": "1", "x-amz-function-error": "Unhandled", "content-type": "application/json", "set-cookie": "s=1", "x-app": "1" }));
    expect(out.has("x-amzn-requestid")).toBe(false);
    expect(out.has("x-amz-function-error")).toBe(false);
    expect(out.get("content-type")).toBe("application/json");
    expect(out.get("set-cookie")).toBe("s=1");
    expect(out.get("x-app")).toBe("1");
    expect(out.get("cache-control")).toBe("no-store");
  });

  test("an app that sets Cache-Control keeps it", () => {
    expect(downstreamHeaders(new Headers({ "cache-control": "private, max-age=60" })).get("cache-control")).toBe("private, max-age=60");
  });

  test("several Set-Cookie headers all survive", () => {
    const upstream = new Headers();
    upstream.append("set-cookie", "a=1");
    upstream.append("set-cookie", "b=2");
    expect([...downstreamHeaders(upstream)].filter(([n]) => n === "set-cookie").map(([, v]) => v)).toEqual(["a=1", "b=2"]);
  });
});

describe("forwarding", () => {
  let seen: Request | null;
  let reply: () => Response | Promise<Response>;
  const fetcher = (async (input: Request) => {
    seen = input;
    return reply();
  }) as unknown as typeof fetch;
  const deps = { fetcher };

  const call = (path: string, init: RequestInit = {}, creds: object = CREDS, api = URL_OK) =>
    forwardToBackend(new Request(`https://my-app.bytauai.pro${path}`, init), api, creds, deps);

  beforeEach(() => {
    seen = null;
    reply = () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  });

  test("a GET is signed for the function URL's region and sent to its address with the path and query", async () => {
    const res = await call("/api/items?limit=5&q=a%20b");

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(JSON.stringify({ ok: true }));
    expect(seen!.url).toBe(`${URL_OK}/api/items?limit=5&q=a%20b`);
    expect(seen!.method).toBe("GET");
    const auth = seen!.headers.get("authorization")!;
    expect(auth).toStartWith("AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/");
    expect(auth).toMatch(/\/eu-west-1\/lambda\/aws4_request/);
    expect(auth).toMatch(/SignedHeaders=[^,]*host[^,]*x-amz-date/);
    expect(seen!.headers.get("x-amz-date")).toMatch(/^\d{8}T\d{6}Z$/);
  });

  test("the region comes from the address, so apps in another region need no other setting", async () => {
    await call("/api/x", {}, CREDS, "https://abc123.lambda-url.us-west-2.on.aws");
    expect(seen!.headers.get("authorization")).toMatch(/\/us-west-2\/lambda\/aws4_request/);
  });

  test("a POST sends its body, with the body's hash signed", async () => {
    const body = JSON.stringify({ title: "hello" });
    await call("/api/items", { method: "POST", headers: { "content-type": "application/json" }, body });

    expect(seen!.method).toBe("POST");
    expect(await seen!.text()).toBe(body);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(seen!.headers.get("x-amz-content-sha256")).toBe(hex);
    expect(seen!.headers.get("authorization")).toContain("x-amz-content-sha256");
    expect(seen!.headers.get("content-type")).toBe("application/json");
  });

  test("a different body is a different signature", async () => {
    await call("/api/items", { method: "POST", body: "one" });
    const first = seen!.headers.get("authorization");
    await call("/api/items", { method: "POST", body: "two" });
    expect(seen!.headers.get("authorization")).not.toBe(first);
  });

  test("every method an API uses is forwarded", async () => {
    for (const method of ["PUT", "PATCH", "DELETE", "OPTIONS"]) {
      await call("/api/items/1", { method, ...(method === "OPTIONS" || method === "DELETE" ? {} : { body: "x" }) });
      expect(seen!.method).toBe(method);
    }
  });

  test("the visitor's bearer token reaches the app as x-tau-authorization, never as the AWS Authorization", async () => {
    await call("/api/me", { headers: { authorization: "Bearer visitor-token" } });
    expect(seen!.headers.get("x-tau-authorization")).toBe("Bearer visitor-token");
    expect(seen!.headers.get("authorization")).toStartWith("AWS4-HMAC-SHA256");
    expect(seen!.headers.get("authorization")).not.toContain("visitor-token");
  });

  test("a visitor cannot choose the address: the path cannot change the host", async () => {
    await call("/api/../../evil", {});
    expect(new URL(seen!.url).origin).toBe(URL_OK);
    await call("//evil.com/api/x", {});
    expect(new URL(seen!.url).origin).toBe(URL_OK);
  });

  // The reason this is a Worker and not a redirect: an AI answer arrives as it is produced.
  test("a streamed response reaches the caller chunk by chunk, not all at the end", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    reply = () =>
      new Response(
        new ReadableStream({
          async start(controller) {
            controller.enqueue(new TextEncoder().encode("first "));
            await gate;
            controller.enqueue(new TextEncoder().encode("second"));
            controller.close();
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );

    const res = await call("/api/stream");
    const reader = res.body!.getReader();

    // The first chunk is readable while the producer is still blocked.
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("first ");
    release();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("second");
    expect((await reader.read()).done).toBe(true);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
  });

  test("the app's status and headers come back, with AWS's removed and caching off", async () => {
    reply = () => new Response("nope", { status: 418, headers: { "x-amzn-requestid": "1", "x-app": "yes" } });
    const res = await call("/api/teapot");

    expect(res.status).toBe(418);
    expect(res.headers.get("x-app")).toBe("yes");
    expect(res.headers.has("x-amzn-requestid")).toBe(false);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  test("an error from the app is passed on, not hidden", async () => {
    reply = () => new Response(JSON.stringify({ error: "bad" }), { status: 500 });
    expect((await call("/api/boom")).status).toBe(500);
  });

  test("HEAD answers with headers and no body", async () => {
    reply = () => new Response("body", { status: 200, headers: { "x-app": "yes" } });
    const res = await call("/api/x", { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });

  test("without the router's AWS credential it is a plain 503 and nothing is sent", async () => {
    const res = await call("/api/x", {}, {});
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("30");
    expect(seen).toBeNull();
  });

  test("an address that is not a function URL is a 404 and nothing is sent", async () => {
    for (const bad of ["https://evil.example.com", "", "http://abc.lambda-url.eu-west-1.on.aws"]) {
      const res = await call("/api/x", {}, CREDS, bad);
      expect(res.status).toBe(404);
    }
    expect(seen).toBeNull();
  });

  test("a body over 6 MB is refused before it is read or sent", async () => {
    const res = await call("/api/upload", {
      method: "POST",
      headers: { "content-length": String(MAX_API_BODY_BYTES + 1) },
      body: "x",
    });
    expect(res.status).toBe(413);
    expect(seen).toBeNull();
  });

  test("a body that lies about its length is still caught by its real size", async () => {
    const big = new Uint8Array(MAX_API_BODY_BYTES + 10);
    const res = await call("/api/upload", { method: "POST", body: big });
    expect(res.status).toBe(413);
    expect(seen).toBeNull();
  });

  test("a backend that cannot be reached is a 502 with nothing about why", async () => {
    reply = () => {
      throw new Error("connect ECONNREFUSED 10.0.0.5:443 internal detail");
    };
    const res = await call("/api/x");
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain("10.0.0.5");
  });

  test("a backend that takes too long is a 504", async () => {
    reply = () => {
      throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
    };
    expect((await call("/api/slow")).status).toBe(504);
    expect(API_TIMEOUT_MS).toBeGreaterThan(15_000);
  });

  test("AWS refusing the request is a 502 that says nothing about credentials", async () => {
    reply = () =>
      new Response('{"Message":"The security token included in the request is invalid."}', {
        status: 403,
        headers: { "x-amzn-errortype": "UnrecognizedClientException" },
      });
    const res = await call("/api/x");
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain("security token");
  });

  test("the app's own 401 and 403 are its answer, and pass through", async () => {
    for (const status of [401, 403]) {
      reply = () => new Response(JSON.stringify({ error: "not allowed" }), { status });
      const res = await call("/api/private");
      expect(res.status).toBe(status);
      expect(await res.text()).toContain("not allowed");
    }
  });
});

describe("/api in the router", () => {
  const HOST = "my-app.bytauai.pro";
  const records = new Map<string, unknown>();
  const reads: string[] = [];
  let forwarded: Request[] = [];

  const env: Env = {
    ...CREDS,
    R2_BUCKET: {
      get: async (key: string) => {
        reads.push(key);
        return key.endsWith("index.html")
          ? { httpEtag: '"e"', httpMetadata: undefined, body: new Blob(["<h1>index</h1>"]).stream(), text: async () => "<h1>index</h1>" }
          : null;
      },
    } as unknown as R2Bucket,
    ROUTES: { get: async (key: string) => records.get(key) ?? null } as unknown as KVNamespace,
    LANDING_URL: "https://tauai.pro",
    APP_URL: "https://app.tauai.pro",
  };
  const deps = {
    fetcher: (async (r: Request) => {
      forwarded.push(r);
      return new Response(JSON.stringify({ from: "lambda" }), { headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch,
  };
  const set = (over: Partial<RoutingRecord> = {}) =>
    records.set(`host:${HOST}`, {
      projectId: "p1",
      slug: "my-app",
      prefix: "tau/sites/u1/p1/d1",
      showBadge: false,
      suspended: false,
      redirectTo: null,
      api: { url: URL_OK },
      ...over,
    });
  const go = (path: string, init: RequestInit = {}) => handle(new Request(`https://${HOST}${path}`, init), env, deps);

  beforeEach(() => {
    records.clear();
    reads.length = 0;
    forwarded = [];
    set();
  });

  test("/api/* goes to the backend, and the static files are not read", async () => {
    const res = await go("/api/items");
    expect(await res.text()).toBe(JSON.stringify({ from: "lambda" }));
    expect(forwarded).toHaveLength(1);
    expect(reads).toHaveLength(0);
  });

  test("POST is allowed on /api and refused everywhere else", async () => {
    expect((await go("/api/items", { method: "POST", body: "{}" })).status).toBe(200);
    expect((await go("/settings", { method: "POST", body: "{}" })).status).toBe(405);
    expect((await go("/", { method: "DELETE" })).status).toBe(405);
    expect(forwarded).toHaveLength(1);
  });

  test("with no backend, /api is a JSON 404 and not the front end's index.html", async () => {
    set({ api: null });
    for (const path of ["/api", "/api/items"]) {
      const res = await go(path);
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).toContain("application/json");
    }
    expect(forwarded).toHaveLength(0);
  });

  test("a record from before backends existed has no api, and keeps serving", async () => {
    records.set(`host:${HOST}`, { projectId: "p1", slug: "my-app", prefix: "tau/sites/u1/p1/d1", showBadge: false, suspended: false });
    expect(await (await go("/")).text()).toBe("<h1>index</h1>");
    expect((await go("/api/x")).status).toBe(404);
  });

  test("a path that only starts with api is the front end's", async () => {
    expect(await (await go("/apiary")).text()).toBe("<h1>index</h1>");
    expect(await (await go("/api-docs")).text()).toBe("<h1>index</h1>");
    expect(forwarded).toHaveLength(0);
  });

  test("a suspended site's API is as suspended as its pages", async () => {
    set({ suspended: true });
    expect((await go("/api/items", { method: "POST", body: "{}" })).status).toBe(403);
    expect(forwarded).toHaveLength(0);
  });

  test("an address that redirects to another does not forward its API", async () => {
    set({ redirectTo: "https://www.example.com" });
    const res = await go("/api/items");
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("https://www.example.com/api/items");
    expect(forwarded).toHaveLength(0);
  });

  test("a custom domain's API is forwarded the same way, and the forwarded host is the domain's", async () => {
    records.set("host:www.example.com", { projectId: "p1", slug: "my-app", prefix: "tau/sites/u1/p1/d1", showBadge: false, suspended: false, redirectTo: null, api: { url: URL_OK } });
    await handle(new Request("https://www.example.com/api/x"), env, deps);
    expect(forwarded[0]!.headers.get("x-forwarded-host")).toBe("www.example.com");
  });
});
