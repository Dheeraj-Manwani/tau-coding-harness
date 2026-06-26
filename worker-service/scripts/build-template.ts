/**
 * Build & publish the E2B template defined in
 * `src/templates/vite-react-hono.ts`.
 *
 * The worker provisions sandboxes from a template named "vite-hono-app"
 * (see `TEMPLATE` in `src/lib/sandbox.ts`), so we publish under that name by
 * default. Re-run this whenever the template definition changes — new deps, the
 * scaffold, or the seeded `.tau/CONTEXT.md` — to roll the change out to all
 * *future* sandboxes (existing ones keep the image they were created from).
 *
 *   bun run build:template                # build/update "vite-hono-app"
 *   bun run build:template --name foo     # publish under a different name
 *   bun run build:template --skip-cache   # force a full rebuild (ignore cache)
 *
 * Requires `E2B_API_KEY` in the environment (or in `.env`, auto-loaded by Bun).
 */
import { Template, defaultBuildLogger, type BuildInfo } from "e2b";

import { template } from "../src/templates/vite-react-hono";

// Keep in sync with TEMPLATE in src/lib/sandbox.ts.
const DEFAULT_NAME = "vite-hono-app";

function parseArgs(argv: string[]): { name: string; skipCache: boolean } {
  let name = DEFAULT_NAME;
  let skipCache = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--name" || arg === "-n") {
      const value = argv[++i];
      if (!value) throw new Error("--name requires a value");
      name = value;
    } else if (arg === "--skip-cache") {
      skipCache = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { name, skipCache };
}

async function main(): Promise<void> {
  if (!process.env.E2B_API_KEY) {
    console.error(
      "E2B_API_KEY is not set — add it to worker-service/.env or export it before running.",
    );
    process.exit(1);
  }

  const { name, skipCache } = parseArgs(process.argv.slice(2));

  console.log(
    `Building E2B template "${name}"${skipCache ? " (cache disabled)" : ""}…\n`,
  );

  // `Template.build` streams the remote build (running every .runCmd step in
  // the definition) and resolves once the image is published.
  const info: BuildInfo = await Template.build(template, name, {
    skipCache,
    onBuildLogs: defaultBuildLogger(),
  });

  console.log("\n✓ Template published");
  console.log(`  name:       ${info.name}`);
  console.log(`  templateId: ${info.templateId}`);
  console.log(`  buildId:    ${info.buildId}`);
  if (info.tags.length > 0) {
    console.log(`  tags:       ${info.tags.join(", ")}`);
  }
}

main().catch((err: unknown) => {
  console.error("\n✗ Template build failed:", err);
  process.exit(1);
});
