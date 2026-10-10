import { expect, test } from "bun:test";

// Module mocks are process-global in Bun, so this runs in a child.
test("database publish: the schema gate and the production client", () => {
  const result = Bun.spawnSync([process.execPath, "test", `${import.meta.dir}/deployDatabase.fixture.ts`], {
    cwd: `${import.meta.dir}/../..`,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr));
  expect(result.exitCode).toBe(0);
});
