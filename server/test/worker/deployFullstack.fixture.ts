import { afterAll, beforeAll, describe, expect, test } from "bun:test";

const { env } = await import("@/lib/env");
const { setLambdaDepsForTests } = await import("@/lib/lambdaApps");
const { DeployError } = await import("@/worker/lib/deploy");
const { verifyBackend, setVerifyDepsForTests, isFunctionUrl } = await import("@/worker/lib/deployFullstack");

const URL_ = "https://abcdefghij.lambda-url.us-east-1.on.aws";
const saved = { ...env };

beforeAll(() => {
  Object.assign(env, {
    BACKEND_HOSTING_ENABLED: true,
    AWS_APPS_REGION: "us-east-1",
    AWS_APPS_ACCESS_KEY_ID: "AKIATESTTESTTESTTEST",
    AWS_APPS_SECRET_ACCESS_KEY: "secret",
  });
});
afterAll(() => {
  Object.assign(env, saved);
  setVerifyDepsForTests(null);
  setLambdaDepsForTests(null);
});

function run(statuses: Array<number | "throw">, logs: string[] = []) {
  const calls: { url: string; auth: boolean }[] = [];
  let sleeps = 0;
  setLambdaDepsForTests({ api: () => ({ api: { recentLogs: async () => logs } as any, config: { region: "us-east-1" } as any }) });
  setVerifyDepsForTests({
    fetcher: (async (input: Request) => {
      calls.push({ url: input.url, auth: (input.headers.get("authorization") ?? "").startsWith("AWS4-HMAC-SHA256") });
      const next = statuses[Math.min(calls.length - 1, statuses.length - 1)]!;
      if (next === "throw") throw new Error("network");
      return new Response("{}", { status: next });
    }) as any,
    sleep: async () => {
      sleeps++;
    },
  });
  return { calls, sleeps: () => sleeps };
}

describe("verifyBackend", () => {
  test("a 200 passes at once, calling /api/health signed with tau's own credentials", async () => {
    const r = run([200]);
    await verifyBackend({ projectId: "p", url: URL_, startedAtMs: 0 });
    expect(r.calls).toEqual([{ url: `${URL_}/api/health`, auth: true }]);
    expect(r.sleeps()).toBe(0);
  });

  test("a URL that is not live yet (403, 404, no answer) is retried until it is", async () => {
    const r = run([403, 404, "throw", 200]);
    await verifyBackend({ projectId: "p", url: URL_, startedAtMs: 0 });
    expect(r.calls.length).toBe(4);
    expect(r.sleeps()).toBe(3);
  });

  test("a 5xx is the app failing: no retries, and the function's own log lines come back", async () => {
    const r = run([500], ["START RequestId: x", "TypeError: db is not defined", "REPORT RequestId: x"]);
    const err = await verifyBackend({ projectId: "p", url: URL_, startedAtMs: 0 }).catch((e) => e);
    expect(err).toBeInstanceOf(DeployError);
    expect(err.message).toContain("health check failed (status 500)");
    expect(err.message).toContain("Nothing was switched over");
    expect(err.buildLog).toBe("TypeError: db is not defined");
    expect(r.calls.length).toBe(1);
  });

  test("never answering gives up after the attempts, with a try-again message", async () => {
    const r = run(["throw"]);
    const err = await verifyBackend({ projectId: "p", url: URL_, startedAtMs: 0 }).catch((e) => e);
    expect(err).toBeInstanceOf(DeployError);
    expect(err.message).toContain("didn't answer");
    expect(r.calls.length).toBe(8);
  });
});

test("isFunctionUrl accepts Lambda function URLs only", () => {
  expect(isFunctionUrl(URL_)).toBe(true);
  expect(isFunctionUrl("http://abcdefghij.lambda-url.us-east-1.on.aws")).toBe(false);
  expect(isFunctionUrl("https://evil.example.com")).toBe(false);
});
