import { expect, test } from "bun:test";

// Module mocks are process-global in Bun. Keep the database fake in a child
// runner so it cannot replace storage in unrelated tests.
test("promo code deactivate / reactivate", () => {
  const result = Bun.spawnSync([process.execPath, "test", `${import.meta.dir}/promoActive.fixture.ts`], {
    cwd: `${import.meta.dir}/../..`,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(result.stderr));
  }
  expect(result.exitCode).toBe(0);
});
