import { describe, expect, test } from "bun:test";
import { withDeadline } from "@/worker/lib/sandbox";

// Restoring a project's files into a fresh sandbox is a blob fetch and a write
// per file, and neither has a deadline of its own. One stalled connection used
// to hold the restore, and the job with it, until the process was restarted.

describe("withDeadline", () => {
  test("passes a result through when the work finishes in time", async () => {
    expect(await withDeadline(Promise.resolve("ok"), 1_000, "x")).toBe("ok");
  });

  test("passes a failure through unchanged", async () => {
    await expect(withDeadline(Promise.reject(new Error("boom")), 1_000, "x")).rejects.toThrow("boom");
  });

  test("gives up on work that never settles, and says what it was", async () => {
    const never = new Promise<string>(() => {});
    await expect(withDeadline(never, 20, "restoring src/App.tsx")).rejects.toThrow(
      "restoring src/App.tsx did not finish within 0.02s",
    );
  });

  test("does not keep the process waiting once the work is done", async () => {
    const started = Date.now();
    await withDeadline(Promise.resolve(1), 60_000, "x");
    expect(Date.now() - started).toBeLessThan(500);
  });
});
