import { expect, test } from "bun:test";

// Module state (env, AWS stand-in) is process-global in Bun, so this runs in a child.
test("full-stack publish: verifying the new backend before it goes live", () => {
  const result = Bun.spawnSync([process.execPath, "test", `${import.meta.dir}/deployFullstack.fixture.ts`], {
    cwd: `${import.meta.dir}/../..`,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr));
  expect(result.exitCode).toBe(0);
});
