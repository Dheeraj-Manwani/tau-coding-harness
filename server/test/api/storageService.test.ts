import { expect, test } from "bun:test";

// The fixture mocks the database and the bucket module-wide, so it runs in its own process.
test("the storage service, routes and key middleware behave end to end", () => {
  const result = Bun.spawnSync([process.execPath, "test", `${import.meta.dir}/storageService.fixture.ts`], {
    cwd: `${import.meta.dir}/../..`,
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = new TextDecoder().decode(result.stderr) + new TextDecoder().decode(result.stdout);
  if (result.exitCode !== 0) throw new Error(out);
  expect(result.exitCode).toBe(0);
}, 60_000);
