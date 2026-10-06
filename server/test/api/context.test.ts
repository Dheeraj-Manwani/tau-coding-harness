import { expect, test } from "bun:test";

// Module mocks are process-global in Bun. Keep the loop/summarize mocks in a
// child runner so they cannot replace `@/worker/agent/loop` for unrelated
// tests (test/worker/balance.test.ts imports the real `balanceToolResults`
// from that same file).
test("clear/summarize chat: auth, concurrency, checkpoint writes, usage snapshot", () => {
  const result = Bun.spawnSync(
    [process.execPath, "test", `${import.meta.dir}/context.fixture.ts`],
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
