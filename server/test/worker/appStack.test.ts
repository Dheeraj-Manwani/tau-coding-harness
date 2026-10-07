import { expect, test } from "bun:test";
import { changesDependencies } from "@/worker/lib/appStack";

// `bun add` in a shell rewrites package.json without a file tool seeing it.
// Unsaved, the next sandbox is restored from the old manifest and the app
// fails on the import — so a command that can do that is followed by a save.
test("a command that can change the app's dependencies is recognised", () => {
  for (const command of [
    "bun add recharts",
    "bun add @fontsource/pacifico 2>&1 | tail -5",
    "cd server && bun add -d vitest",
    "bun remove react-icons",
    "bun install",
    "bun i",
    "bun update",
    "npm install left-pad",
    "(pnpm add zod)",
    "bun run build && bun add framer-motion",
  ]) {
    expect(changesDependencies(command)).toBe(true);
  }
  for (const command of [
    "bun run build",
    "bun run lint 2>&1 | tail -20",
    "bunx tsc --noEmit",
    "ls node_modules/lucide-react/dist | head",
    "grep -rn 'bun add' docs/",
    "curl -s localhost:3000/api/install",
    "echo add",
  ]) {
    expect(changesDependencies(command)).toBe(false);
  }
});

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
