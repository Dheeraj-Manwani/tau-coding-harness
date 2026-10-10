import { expect, test } from "bun:test";

// The fixture mocks the database, key store and environment module-wide, so it runs in its own process.
test("enable_storage, its deploy manifest and the storage environment", () => {
  const result = Bun.spawnSync([process.execPath, "test", `${import.meta.dir}/enableStorage.fixture.ts`], {
    cwd: `${import.meta.dir}/../..`,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(result.stderr) + new TextDecoder().decode(result.stdout));
  }
  expect(result.exitCode).toBe(0);
}, 60_000);
