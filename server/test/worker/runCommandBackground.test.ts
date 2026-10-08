import { describe, expect, test } from "bun:test";
import { isLongRunning } from "@/worker/agent/tools/functions/utils";

// `run_command` starts a command in the background when it looks like one that
// never exits. A wrong yes costs a step: the call comes back empty with a log
// path, and reading the output takes a second call.

describe("a command is sent to the background when it starts a server", () => {
  test.each([
    "bunx vite",
    "bunx vite --host",
    "bunx --bun vite --host 0.0.0.0",
    "npx vite",
    "bun x vite",
    "pnpm exec vite",
    "vite",
    "vite dev",
    "vite preview",
    "node_modules/.bin/vite --host",
    "./node_modules/.bin/vite",
    "bun run dev",
    "bun dev",
    "npm start",
    "npm run serve",
    "pnpm preview",
    "yarn dev",
    "bunx next dev",
    "next start",
    "cd web && bunx vite --host",
    "PORT=3000 bunx vite",
    "nohup bunx vite > /tmp/vite.log 2>&1",
    "(bunx vite --host) > .tau/logs/x.log 2>&1",
    "bun install; bun run dev",
    "python -m http.server --port 8000",
  ])("%s", (command) => {
    expect(isLongRunning(command)).toBe(true);
  });
});

describe("a command that only mentions a server is waited for", () => {
  // Every one of these was sent to the background in a real run, because it
  // contained the word `vite`.
  test.each([
    "cat package.json; echo ---; ls node_modules | head -30; echo ---; cat node_modules/vite/package.json | grep -E '\"version\"|\"name\"'; echo ---; ls node_modules/.bin | grep -i vite",
    'grep -rn "__BUNDLED_DEV__" node_modules/vite/dist/client/client.mjs | head -20',
    "curl -s http://localhost:5173/@vite/client | sed -n '855,870p'",
    "sed -n '24400,24470p' node_modules/vite/dist/node/chunks/node.js",
    "tail -40 /home/user/.tau-vite.log 2>/dev/null; echo \"=== vite version resolved:\"; grep -rn '\"vite\"' bun.lock | head -5; ls",
    "ps aux | grep -i vite | grep -v grep | head",
    "ls -la node_modules/.vite 2>/dev/null; find node_modules/.vite -name '*.js' | head",
    "bun install 2>&1 | tail -15; echo \"=== installed:\"; grep -n '\"version\"' node_modules/vite/package.json | head -2",
    "sleep 6; tail -15 /home/user/.tau-vite.log",
    "bun add -d vite@8.3.4",
    "echo vite",
  ])("%s", (command) => {
    expect(isLongRunning(command)).toBe(false);
  });

  test.each([
    // These run Vite, and finish.
    "bunx vite build",
    "bunx vite --version",
    "vite optimize",
    "bun run build 2>&1 | tail -25",
    "bunx tsc -b",
    "bun test",
    "bunx next build",
    // A script name is only a dev server when it is the script being run.
    "echo 'run bun run dev to start'",
    "grep -n '\"dev\"' package.json",
  ])("%s", (command) => {
    expect(isLongRunning(command)).toBe(false);
  });
});
