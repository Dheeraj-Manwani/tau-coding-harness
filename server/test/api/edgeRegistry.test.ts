import { expect, test } from "bun:test";

// Module mocks are process-global in Bun. Keep the database stand-in in a child
// runner so it cannot replace storage in unrelated tests.
test("the edge routing records: states, pushes, reconciler, Cloudflare client", () => {
  const result = Bun.spawnSync([process.execPath, "test", `${import.meta.dir}/edgeRegistry.fixture.ts`], {
    cwd: `${import.meta.dir}/../..`,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(result.stderr));
  }
  expect(result.exitCode).toBe(0);
});
