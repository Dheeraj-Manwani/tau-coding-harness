import { expect, test } from "bun:test";

// Module mocks are process-global in Bun, so the stand-ins live in a child runner.
test("Neon databases: create, adopt, branch and remove against a stand-in for Neon", () => {
  const result = Bun.spawnSync([process.execPath, "test", `${import.meta.dir}/neonApps.fixture.ts`], {
    cwd: `${import.meta.dir}/../..`,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr));
  expect(result.exitCode).toBe(0);
});
