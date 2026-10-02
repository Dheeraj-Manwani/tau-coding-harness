import { afterEach, describe, expect, test } from "bun:test";
import { clearMemo, memo } from "../../src/api/lib/memo";

afterEach(() => clearMemo());

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => void (t += ms) };
}

describe("memo", () => {
  test("serves from cache within the TTL and recomputes after it", async () => {
    const c = clock();
    let calls = 0;
    const get = () => memo("k", async () => ++calls, { ttlMs: 30_000, now: c.now });

    expect((await get()).value).toBe(1);
    c.advance(29_999);
    expect((await get()).value).toBe(1);
    c.advance(1);
    expect((await get()).value).toBe(2);
  });

  test("concurrent callers share one computation", async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const compute = async () => {
      calls++;
      await gate;
      return calls;
    };
    const a = memo("k", compute, { ttlMs: 1_000 });
    const b = memo("k", compute, { ttlMs: 1_000 });
    release();
    expect([(await a).value, (await b).value]).toEqual([1, 1]);
    expect(calls).toBe(1);
  });

  test("a forced refresh is throttled by minFreshMs", async () => {
    const c = clock();
    let calls = 0;
    const get = (fresh: boolean) =>
      memo("k", async () => ++calls, { ttlMs: 60_000, fresh, minFreshMs: 10_000, now: c.now });

    await get(false);
    c.advance(5_000);
    expect((await get(true)).value).toBe(1);
    c.advance(5_000);
    expect((await get(true)).value).toBe(2);
  });

  test("ttlFor shortens the life of a value and rejections are never cached", async () => {
    const c = clock();
    let calls = 0;
    const get = () =>
      memo("k", async () => ({ ok: ++calls > 1 }), {
        ttlMs: 60_000,
        ttlFor: (v) => (v.ok ? 60_000 : 1_000),
        now: c.now,
      });
    expect((await get()).value.ok).toBe(false);
    c.advance(1_000);
    expect((await get()).value.ok).toBe(true);

    await expect(memo("boom", async () => Promise.reject(new Error("x")), { ttlMs: 1_000 })).rejects.toThrow("x");
    expect((await memo("boom", async () => "fine", { ttlMs: 1_000 })).value).toBe("fine");
  });
});
