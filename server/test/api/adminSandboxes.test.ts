import { expect, test } from "bun:test";

// Module mocks are process-global in Bun. Keep the E2B/database fakes in a
// child runner so they cannot replace the real modules in unrelated tests.
test("orphan sandbox kill refusals and live-sandbox classification", () => {
  const result = Bun.spawnSync([process.execPath, "test", `${import.meta.dir}/adminSandboxes.fixture.ts`], {
    cwd: `${import.meta.dir}/../..`,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(result.stderr));
  }
  expect(result.exitCode).toBe(0);
});
