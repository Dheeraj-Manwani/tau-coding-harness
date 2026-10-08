import { describe, expect, test } from "bun:test";
import { Gate, gatedFetch, retryDelayMs } from "@/lib/kimi";

// Moonshot allows an account a number of requests at once and answers the rest
// with a 429. Every call to it waits its turn, and a 429 is waited out.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("the gate", () => {
  test("lets only as many through at once as it is told, and all of them through in the end", async () => {
    const gate = new Gate(2);
    let active = 0;
    let peak = 0;
    const done: number[] = [];
    await Promise.all(
      Array.from({ length: 7 }, (_, i) =>
        gate.run(async () => {
          active++;
          peak = Math.max(peak, active);
          await sleep(5);
          active--;
          done.push(i);
        }),
      ),
    );
    expect(peak).toBe(2);
    expect(done).toHaveLength(7);
  });

  test("a call that throws gives its place up", async () => {
    const gate = new Gate(1);
    await expect(gate.run(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(await gate.run(async () => "next")).toBe("next");
  });
});

describe("waiting out a rate limit", () => {
  test("a 429 is tried again, and the answer that follows is the one returned", async () => {
    let calls = 0;
    const inner = (async () => {
      calls++;
      return calls < 3 ? new Response("slow down", { status: 429, headers: { "retry-after": "0.01" } }) : new Response("ok");
    }) as unknown as typeof fetch;
    const res = await gatedFetch(inner)("https://example.test");
    expect(await res.text()).toBe("ok");
    expect(calls).toBe(3);
  });

  test("other errors are not retried here", async () => {
    let calls = 0;
    const inner = (async () => { calls++; return new Response("no", { status: 500 }); }) as unknown as typeof fetch;
    expect((await gatedFetch(inner)("https://example.test")).status).toBe(500);
    expect(calls).toBe(1);
  });

  test("how long to wait grows, honours Retry-After, and is capped", () => {
    expect(retryDelayMs(1, null)).toBeGreaterThanOrEqual(1000);
    expect(retryDelayMs(3, null)).toBeGreaterThanOrEqual(3000);
    expect(retryDelayMs(1, "4")).toBeGreaterThanOrEqual(4000);
    expect(retryDelayMs(1, "4")).toBeLessThan(4500);
    expect(retryDelayMs(1, "600")).toBeLessThan(15_500);
  });
});
