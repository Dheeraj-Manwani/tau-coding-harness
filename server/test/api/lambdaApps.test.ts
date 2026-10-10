import { expect, test } from "bun:test";

// Module mocks are process-global in Bun. Keep the database and AWS stand-ins in
// a child runner so they cannot replace anything in other tests.
test("Lambda backends: create, update, prune and remove against a stand-in for AWS", () => {
  const result = Bun.spawnSync([process.execPath, "test", `${import.meta.dir}/lambdaApps.fixture.ts`], {
    cwd: `${import.meta.dir}/../..`,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(result.stderr));
  }
  expect(result.exitCode).toBe(0);
});
