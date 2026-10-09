import { expect, test } from "bun:test";

// Module mocks are process-global in Bun. Keep the database, DNS and Cloudflare
// stand-ins in a child runner so they cannot replace anything in other tests.
test("custom domains: adding, ownership before Cloudflare, activation, primary, removal", () => {
  const result = Bun.spawnSync([process.execPath, "test", `${import.meta.dir}/domainService.fixture.ts`], {
    cwd: `${import.meta.dir}/../..`,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(result.stderr));
  }
  expect(result.exitCode).toBe(0);
});
