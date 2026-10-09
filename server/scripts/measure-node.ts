/**
 * Measure Node against Bun for a generation-2 app's server, in a real sandbox.
 *
 *   bun run scripts/measure-node.ts [--runs 3] [--keep]
 *
 * Boots a fresh pod from the generation-2 image, gives it the database app
 * (`server/index.ts` plus `server/db/*`, the heaviest the scaffolds get), installs
 * Node from the official tarball, and starts the server each way from cold:
 * `bun --watch server/index.ts` as `restartAppServer` does today, and
 * `tsx watch` over a launcher on `@hono/node-server` as Phase 1.5 proposes.
 * Reports time to the first healthy `/api/health` and resident memory five
 * seconds later, summed over every process the server is made of.
 *
 * The numbers decide step 1.3 of doc/PUBLISHING.md, which is whether the app
 * server moves to Node in the sandbox. Costs one short sandbox. Changes nothing
 * outside it.
 */
import { Sandbox } from "e2b";
import { TEMPLATES } from "@/worker/templates/registry";
import {
  HONO_SERVER_INDEX,
  DB_CLIENT_TS,
  DB_SCHEMA_TS,
  DB_VALIDATION_TS,
  HONO_DB_SERVER_INDEX,
} from "@/worker/templates/shared";

const RUNS = Number(process.argv[process.argv.indexOf("--runs") + 1]) || 3;
const KEEP = process.argv.includes("--keep");
/** Seconds of idle CPU sampled after the memory reading. */
const IDLE_WINDOW_S = 10;
/** `--api`: the API-only scaffold, with no database, to separate Node's own cost from PGlite's. */
const API_ONLY = process.argv.includes("--api");
const APP = "/home/user/app";

const sandbox = await Sandbox.create(TEMPLATES["v2-frontend"].e2bName, { timeoutMs: 20 * 60_000 });
console.log(`sandbox ${sandbox.sandboxId}`);

async function sh(command: string, timeoutMs = 120_000): Promise<string> {
  try {
    const res = await sandbox.commands.run(command, { cwd: APP, timeoutMs });
    return `${res.stdout}${res.stderr}`.trim();
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    throw new Error(`${command.slice(0, 80)} failed:\n${e.stdout ?? ""}${e.stderr ?? String(err)}`);
  }
}

try {
  console.log("uname:", await sh("uname -m; nproc; free -m | head -2"));
  console.log("bun:", await sh("bun --version"));

  // The app: the database scaffold, as `add_database` would leave it.
  console.log(API_ONLY ? "app: API only" : "app: API + database");
  if (API_ONLY) {
    await sh("bun add hono", 240_000);
    await sandbox.files.write(`${APP}/server/index.ts`, HONO_SERVER_INDEX);
  } else {
    await sh("bun add hono drizzle-orm @electric-sql/pglite drizzle-zod @hono/zod-validator", 240_000);
    await sandbox.files.write(`${APP}/server/index.ts`, HONO_DB_SERVER_INDEX);
    await sandbox.files.write(`${APP}/server/db/schema.ts`, DB_SCHEMA_TS);
    await sandbox.files.write(`${APP}/server/db/client.ts`, DB_CLIENT_TS);
    await sandbox.files.write(`${APP}/server/db/validation.ts`, DB_VALIDATION_TS);
  }

  // Node, from the official tarball: the newest 24.x, which is Lambda's runtime.
  const t0 = Date.now();
  const version = (
    await sh(
      "curl -fsSL https://nodejs.org/dist/index.json | grep -o '\"version\":\"v24\\.[0-9.]*\"' | head -1 | cut -d'\"' -f4",
    )
  ).trim();
  console.log("node version:", version);
  await sh(
    `mkdir -p $HOME/.node && curl -fsSL https://nodejs.org/dist/${version}/node-${version}-linux-x64.tar.gz | tar -xz -C $HOME/.node --strip-components=1`,
    240_000,
  );
  console.log(`node installed in ${((Date.now() - t0) / 1000).toFixed(1)}s:`, await sh("$HOME/.node/bin/node --version"));
  console.log("node install size:", await sh("du -sh $HOME/.node | cut -f1"));

  const tPk = Date.now();
  await sh("bun add tsx @hono/node-server", 240_000);
  console.log(`tsx + @hono/node-server added in ${((Date.now() - tPk) / 1000).toFixed(1)}s`);
  await sh("mkdir -p .tau");
  await sandbox.files.write(
    `${APP}/.tau/dev-server.ts`,
    `import { serve } from '@hono/node-server'\nimport server from '../server/index'\n\nserve({ fetch: server.fetch, port: server.port ?? 3000 })\n`,
  );

  await sandbox.files.write(
    "/tmp/measure.sh",
    `#!/bin/bash
# usage: measure.sh <label> <command...>
# The server runs in its own session so it can be stopped and measured as a
# group. (pkill -f would match this script too: its own arguments name the command.)
label=$1; shift
cd ${APP}
export PATH=$HOME/.node/bin:$PATH
rm -rf data
start=$(date +%s%N)
setsid nohup bash -c "$*" > /tmp/$label.log 2>&1 &
pid=$!
code=000
for i in $(seq 1 600); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 1 http://localhost:3000/api/health)
  [ "$code" = 200 ] && break
  sleep 0.05
done
end=$(date +%s%N)
echo "health_ms=$(( (end-start)/1000000 )) code=$code"
cpu() { ps -o times= -g $pid | awk '{s+=$1} END {print s+0}'; }
echo "cpu_start_s=$(cpu)"
sleep 5
# resident memory of every process the server is made of, not the wrapper shell
ps -o rss=,comm= -g $pid | grep -v -E "^ *[0-9]+ bash" | awk '{print "  proc rss_kb=" $1 " " $2}'
ps -o rss=,comm= -g $pid | grep -v -E "^ *[0-9]+ bash" | awk '{s+=$1} END {print "rss_kb=" s}'
curl -s http://localhost:3000/api/items | head -c 80; echo
c1=$(cpu); sleep ${IDLE_WINDOW_S}; c2=$(cpu)
echo "cpu_idle_s=$(( c2 - c1 ))"
kill -- -$pid 2>/dev/null; sleep 1
kill -9 -- -$pid 2>/dev/null
exit 0
`,
  );
  await sh("chmod +x /tmp/measure.sh");

  // Every way of running the server worth comparing. Node needs a TypeScript
  // loader (`tsx`): the generated files import without extensions, which Node's
  // own type stripping refuses. `--watch` is Node's built-in restart on change.
  const ENV = "--env-file-if-exists=.env";
  const variants: Record<string, string> = {
    bun: "bun --watch server/index.ts",
    "node-plain-48": `node --max-old-space-size=48 --import tsx ${ENV} .tau/dev-server.ts`,
    "node-plain-96": `node --max-old-space-size=96 --import tsx ${ENV} .tau/dev-server.ts`,
    "node-plain-64": `node --max-old-space-size=64 --import tsx ${ENV} .tau/dev-server.ts`,
    "node-plain": `node --import tsx ${ENV} .tau/dev-server.ts`,
  };
  const names = Object.keys(variants);
  const results: Record<string, { ms: number[]; kb: number[]; cpuStart: number[]; cpuIdle: number[] }> = Object.fromEntries(
    names.map((n) => [n, { ms: [], kb: [], cpuStart: [], cpuIdle: [] }]),
  );

  for (let run = 1; run <= RUNS; run++) {
    for (const name of names) {
      const out = await sh(`/tmp/measure.sh ${name} '${variants[name]}'`, 240_000);
      console.log(`--- ${name} run ${run}
${out}`);
      const grab = (re: RegExp) => Number(re.exec(out)?.[1]);
      const push = (list: number[], v: number) => Number.isFinite(v) && list.push(v);
      push(results[name]!.ms, grab(/health_ms=(\d+)/));
      push(results[name]!.kb, grab(/^rss_kb=(\d+)/m));
      push(results[name]!.cpuStart, grab(/^cpu_start_s=(\d+)/m));
      push(results[name]!.cpuIdle, grab(/^cpu_idle_s=(\d+)/m));
    }
  }

  const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? NaN;
  const base = results.bun!;
  console.log("\n=== summary (median of runs; deltas against bun) ===");
  for (const name of names) {
    const r = results[name]!;
    const mb = med(r.kb) / 1024;
    console.log(
      `${name.padEnd(16)} healthy ${(med(r.ms) / 1000).toFixed(2)}s   rss ${mb.toFixed(0)} MB (${name === "bun" ? "base" : `${(mb - med(base.kb) / 1024 >= 0 ? "+" : "")}${(mb - med(base.kb) / 1024).toFixed(0)} MB`})   cpu to start ${med(r.cpuStart)}s   idle cpu ${med(r.cpuIdle)}s per ${IDLE_WINDOW_S}s   [${r.kb.map((k) => (k / 1024).toFixed(0)).join(", ")} MB]`,
    );
  }
} finally {
  if (!KEEP) await sandbox.kill().catch(() => {});
}
