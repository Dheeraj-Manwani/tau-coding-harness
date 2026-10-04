import { describe, expect, test } from "bun:test";
import { probePreviewHttp, waitForPreviewHttp, type PreviewHttpState } from "@/worker/lib/previewReadiness";

const origin = "https://preview.example.test";
const html = '<script type="module" src="/@vite/client"></script><script src="/src/main.tsx" type="module"></script><script type="module" src="https://cdn.example.test/lib.js"></script>';
const response = (body: string, type: string, status = 200) => new Response(body, { status, headers: { "content-type": type } });
describe("preview HTTP readiness", () => {
  test("checks local entry transforms and does not probe external scripts", async () => {
    const calls: string[] = [];
    const request = (async (url: string) => {
      calls.push(url);
      return url === origin ? response(html, "text/html") : response("export {}", "application/javascript");
    });
    expect(await probePreviewHttp(origin, request)).toBe("ready");
    expect(calls).toEqual([origin, `${origin}/@vite/client`, `${origin}/src/main.tsx`]);
  });
  test("HTTP success with HTML returned for an entry module is not ready", async () => {
    const request = async () => response(html, "text/html");
    expect(await probePreviewHttp(origin, request)).toBe("starting");
  });
  test("network/restart failures are transient", async () => {
    const request = async () => { throw new Error("connection reset"); };
    expect(await probePreviewHttp(origin, request)).toBe("starting");
  });
  test("a genuine compile error remains available for repair", async () => {
    const request = async (url: string) => url === origin ? response(html, "text/html") : response("compile error", "text/plain", 500);
    expect(await probePreviewHttp(origin, request)).toBe("build-error");
  });
  test("a restart between successes resets the stability requirement", async () => {
    const states: PreviewHttpState[] = ["ready", "starting", "ready", "ready"];
    let calls = 0;
    expect(await waitForPreviewHttp(origin, { intervalMs: 1, timeoutMs: 100, probe: async () => states[calls++]! })).toBe("ready");
    expect(calls).toBe(4);
  });
  test("a server that never starts reaches a bounded failure", async () => {
    await expect(waitForPreviewHttp(origin, { intervalMs: 1, timeoutMs: 10, probe: async () => "starting" })).rejects.toThrow("did not become ready");
  });
});
