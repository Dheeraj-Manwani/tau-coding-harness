import { expect, test } from "bun:test";

// Module mocks are process-global in Bun. Keep the database/credit fixture in a
// child runner so it cannot replace storage or billing in unrelated tests.
test("feedback validation, file ownership and EXTRA100 redemption", () => {
  const result = Bun.spawnSync([process.execPath, "test", `${import.meta.dir}/feedback.fixture.ts`], {
    cwd: `${import.meta.dir}/../..`,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(result.stderr));
  }
  expect(result.exitCode).toBe(0);
});
