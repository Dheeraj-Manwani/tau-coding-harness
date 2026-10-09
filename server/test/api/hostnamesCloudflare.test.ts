import { describe, expect, test } from "bun:test";
import {
  CloudflareHostnameError,
  cloudflareHostnames,
  stateFromCloudflare,
} from "@/lib/cloudflareHostnames";

// The calls tau makes to Cloudflare for a custom hostname, checked request by
// request, and how Cloudflare's two status fields become a domain's state.

const config = { zoneId: "zone1", token: "tok", cnameTarget: "cname.bytauai.pro" };
const BASE = "https://api.cloudflare.com/client/v4/zones/zone1/custom_hostnames";

function recorder(replies: { status?: number; body: unknown }[]) {
  const calls: { url: string; method: string; headers: Record<string, string>; body: unknown }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      method: init.method!,
      headers: init.headers as Record<string, string>,
      body: init.body ? JSON.parse(init.body as string) : undefined,
    });
    const reply = replies.shift() ?? { body: { success: true, result: null } };
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
  }) as unknown as typeof fetch;
  return { calls, client: cloudflareHostnames(config, fetcher) };
}

describe("the Cloudflare custom hostname client", () => {
  test("creating asks for HTTP validation with a modern TLS floor", async () => {
    const { calls, client } = recorder([{ body: { success: true, result: { id: "h1", hostname: "www.example.com", status: "pending" } } }]);
    const made = await client.create("www.example.com");

    expect(made.id).toBe("h1");
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: BASE,
      body: { hostname: "www.example.com", ssl: { method: "http", type: "dv", settings: { min_tls_version: "1.2" } } },
    });
    expect(calls[0]!.headers.Authorization).toBe("Bearer tok");
  });

  test("reads one hostname by id, with the id escaped", async () => {
    const { calls, client } = recorder([{ body: { success: true, result: { id: "a/b", status: "active" } } }]);
    await client.get("a/b");
    expect(calls[0]).toMatchObject({ method: "GET", url: `${BASE}/a%2Fb` });
  });

  test("finds a hostname by name, and only an exact match", async () => {
    const { calls, client } = recorder([
      { body: { success: true, result: [{ id: "x", hostname: "www.example.com.evil.net" }, { id: "y", hostname: "www.example.com" }] } },
      { body: { success: true, result: [] } },
    ]);
    expect((await client.findByName("www.example.com"))?.id).toBe("y");
    expect(calls[0]!.url).toBe(`${BASE}?hostname=www.example.com`);
    expect(await client.findByName("none.example.com")).toBeNull();
  });

  test("removing sends DELETE, and a hostname already gone is fine", async () => {
    const { calls, client } = recorder([
      { body: { success: true, result: { id: "h1" } } },
      { status: 404, body: { success: false, errors: [{ code: 1409, message: "not found" }] } },
    ]);
    await client.remove("h1");
    await client.remove("h2");
    expect(calls.map((c) => c.method)).toEqual(["DELETE", "DELETE"]);
  });

  test("any other failure is an error carrying Cloudflare's code and reason", async () => {
    const { client } = recorder([{ status: 409, body: { success: false, errors: [{ code: 1406, message: "Duplicate custom hostname found." }] } }]);
    const err = await client.create("www.example.com").catch((e) => e);

    expect(err).toBeInstanceOf(CloudflareHostnameError);
    expect(err.code).toBe(1406);
    expect(err.status).toBe(409);
    expect(err.message).toContain("Duplicate custom hostname");

    const { client: denied } = recorder([{ status: 403, body: { success: false, errors: [{ code: 10000, message: "Authentication error" }] } }]);
    await expect(denied.remove("h1")).rejects.toThrow("Authentication error");
  });

  test("a 200 whose body says it failed is still a failure", async () => {
    const { client } = recorder([{ body: { success: false, errors: [{ message: "quota exceeded" }] } }]);
    await expect(client.create("www.example.com")).rejects.toThrow("quota exceeded");
  });
});

describe("a domain's state from what Cloudflare says", () => {
  const state = (status: string, ssl: string, extra: object = {}) => stateFromCloudflare({ status, ssl: { status: ssl }, ...extra });

  test("active only when the hostname and its certificate are both active", () => {
    expect(state("active", "active")).toEqual({ state: "ACTIVE" });
    expect(state("active", "pending_deployment")).toEqual({ state: "ISSUING" });
    expect(state("pending", "active")).toEqual({ state: "VERIFYING" });
  });

  test("waiting to see the CNAME resolve is VERIFYING", () => {
    expect(state("pending", "initializing")).toEqual({ state: "VERIFYING" });
    expect(state("pending", "pending_validation")).toEqual({ state: "VERIFYING" });
    expect(stateFromCloudflare({ status: "pending" })).toEqual({ state: "VERIFYING" });
  });

  test("a certificate being made is ISSUING", () => {
    for (const ssl of ["pending_issuance", "pending_deployment", "staging_deployment", "holding_deployment"]) {
      expect(state("pending", ssl)).toEqual({ state: "ISSUING" });
    }
  });

  test("a certificate that timed out or expired fails, with advice rather than a code", () => {
    for (const ssl of ["initializing_timed_out", "validation_timed_out", "issuance_timed_out", "deployment_timed_out", "expired"]) {
      const s = state("pending", ssl);
      expect(s.state).toBe("FAILED");
      if (s.state === "FAILED") expect(s.reason).toContain("exactly as shown");
    }
  });

  test("a dead hostname fails with Cloudflare's own reason when it gave one", () => {
    const s = state("blocked", "initializing", { verification_errors: ["Hostname is blocked."] });
    expect(s).toEqual({ state: "FAILED", reason: "Hostname is blocked." });

    const fromSsl = stateFromCloudflare({ status: "moved", ssl: { status: "pending_validation", validation_errors: [{ message: "CAA record forbids issuance." }] } });
    expect(fromSsl).toEqual({ state: "FAILED", reason: "CAA record forbids issuance." });
  });

  test("a dead hostname with no reason still fails with something to do", () => {
    const s = state("deleted", "deleted");
    expect(s.state).toBe("FAILED");
    if (s.state === "FAILED") expect(s.reason).toContain("Remove it and add it again");
  });

  test("a status tau does not know is treated as still waiting, not as a failure", () => {
    expect(state("something_new", "something_new")).toEqual({ state: "VERIFYING" });
  });
});
