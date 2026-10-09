import { expect, test } from "bun:test";

// Module mocks are process-global in Bun. Keep the R2 fake in a child runner so
// it cannot replace storage in unrelated tests.
test("a publish builds and uploads from the app directory", () => {
  const result = Bun.spawnSync([process.execPath, "test", `${import.meta.dir}/deployUpload.fixture.ts`], {
    cwd: `${import.meta.dir}/../..`,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(result.stderr));
  }
  expect(result.exitCode).toBe(0);
});
