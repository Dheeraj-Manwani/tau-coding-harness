/**
 * Phase S spike: does a sandbox's `envs` reach the process started by the
 * template's `setStartCmd`?
 *
 * This decides how much of §4's three-layer injection is actually needed.
 * E2B documents sandbox `envs` as "used when executing commands and code in the
 * sandbox" — which is explicitly about *commands we run later*, and says nothing
 * about the start command that boots with the image. If the Hono server does not
 * inherit them, layers 2 (a written `.env`) and 3 (restart the server) carry the
 * whole feature.
 *
 *   bun run scripts/spike-e2b-envs.ts
 *
 * Creates one real sandbox and kills it. Costs a few cents of E2B time.
 */
import "../deploy/load-env";
import { Sandbox } from "e2b";

const TEMPLATE = "vite-hono-app";
const WORK_DIR = "/home/user/app";
const CANARY = "tau_spike_canary_value_12345";

function verdict(label: string, ok: boolean, detail = ""): void {
  console.log(`  ${ok ? "YES" : "NO "}  ${label}${detail ? ` — ${detail}` : ""}`);
}

const sandbox = await Sandbox.create(TEMPLATE, {
  timeoutMs: 120_000,
  envs: { TAU_SPIKE_CANARY: CANARY },
});
console.log(`sandbox ${sandbox.sandboxId} (${TEMPLATE})\n`);

try {
  // 1. Baseline: does an explicitly-run command see it? (E2B documents yes.)
  const direct = await sandbox.commands.run("echo -n \"$TAU_SPIKE_CANARY\"", {
    cwd: WORK_DIR,
  });
  verdict(
    "a command we run sees the env",
    direct.stdout.trim() === CANARY,
    JSON.stringify(direct.stdout.trim()),
  );

  // 2. THE QUESTION: does the already-running start-cmd process have it?
  //    Read the environ of the Hono process the template's setStartCmd booted.
  const pidRes = await sandbox.commands.run(
    "pgrep -f 'server/index.ts' | head -1",
    { cwd: WORK_DIR },
  );
  const pid = pidRes.stdout.trim();

  if (!pid) {
    verdict("found the start-cmd server process", false, "pgrep returned nothing");
  } else {
    // /proc/<pid>/environ is NUL-separated; tr it to newlines and grep.
    const environ = await sandbox.commands.run(
      `tr '\\0' '\\n' < /proc/${pid}/environ | grep '^TAU_SPIKE_CANARY=' || true`,
      { cwd: WORK_DIR },
    );
    const seen = environ.stdout.trim();
    verdict(
      `the setStartCmd process (pid ${pid}) inherited the env`,
      seen === `TAU_SPIKE_CANARY=${CANARY}`,
      seen || "(absent from its environ)",
    );
  }

  // 3. Fallback check: if we write a .env and restart the server, does Bun pick
  //    it up? This is layer 2 + 3, and is what we rely on if (2) is NO.
  await sandbox.files.write(`${WORK_DIR}/.env`, `TAU_SPIKE_DOTENV=${CANARY}\n`);
  const viaDotenv = await sandbox.commands.run(
    `bun -e 'process.stdout.write(process.env.TAU_SPIKE_DOTENV ?? "")'`,
    { cwd: WORK_DIR },
  );
  verdict(
    "a freshly-started Bun process auto-loads .env from the workdir",
    viaDotenv.stdout.trim() === CANARY,
    JSON.stringify(viaDotenv.stdout.trim()),
  );
} finally {
  await sandbox.kill();
  console.log("\nsandbox killed");
}
