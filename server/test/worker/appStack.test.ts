import { expect, test } from "bun:test";

// Module mocks are process-global in Bun. The fixture replaces `@/lib/prisma`
// and the server-restart helper in `@/worker/lib/aiEnv`, which would break
// every other suite that imports the real ones — so it runs in a child, the
// same way context.test.ts / feedback.test.ts do.
test("addBackend / addDatabase: idempotent, non-destructive, level follows the app", () => {
  const result = Bun.spawnSync(
    [process.execPath, "test", `${import.meta.dir}/appStack.fixture.ts`],
    {
      cwd: `${import.meta.dir}/../..`,
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  if (result.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(result.stderr));
  }
  expect(result.exitCode).toBe(0);
});
