import { expect, test } from "bun:test";

test("attachment upload fallback validates ownership and file bytes", () => {
  const result = Bun.spawnSync([process.execPath, "test", `${import.meta.dir}/attachmentUpload.fixture.ts`], {
    cwd: `${import.meta.dir}/../..`, stdout: "pipe", stderr: "pipe",
  });
  if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr));
  expect(result.exitCode).toBe(0);
});
