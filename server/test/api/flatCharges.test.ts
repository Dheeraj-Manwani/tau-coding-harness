import { expect, test } from "bun:test";

// Module mocks are process-global in Bun, and this needs CREDITS_ENFORCE on.
// Keep the in-memory ledger in a child runner so neither leaks into other tests.
test("fixed prices: chargeFlat, the name and logo save, AI logos", () => {
  const result = Bun.spawnSync([process.execPath, "test", `${import.meta.dir}/flatCharges.fixture.ts`], {
    cwd: `${import.meta.dir}/../..`,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(result.stderr));
  }
  expect(result.exitCode).toBe(0);
});
