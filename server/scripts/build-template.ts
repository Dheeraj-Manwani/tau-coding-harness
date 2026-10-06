/**
 * Build & publish the E2B sandbox templates defined in `src/templates/`.
 *
 * The worker provisions sandboxes by the E2B image name in
 * `src/templates/registry.ts`, so we publish under those names. Re-run this
 * whenever a template definition changes — new deps, the scaffold, or the
 * seeded `.tau/CONTEXT.md` — to roll the change out to all *future* sandboxes
 * (existing ones keep the image they were created from).
 *
 *   bun run build:template --key v2-frontend  # build one template by key
 *   bun run build:template --key fullstack-db --skip-cache
 *   bun run build:template --name foo         # override the published name (single key only)
 *   bun run build:template --all              # build EVERY template (see below)
 *
 * A key is required. Publishing replaces the image under that name for every
 * sandbox created afterwards, on whatever deployment shares this E2B account —
 * and the generation-1 images (frontend | fullstack | fullstack-db) are what
 * existing projects boot from. So rebuilding them is a deliberate act: name the
 * key, or pass `--all` and mean it.
 *
 * Valid keys: frontend | fullstack | fullstack-db | v2-frontend (see registry.ts).
 * The other v2-* keys are stack levels of the v2-frontend image, not images of
 * their own; naming one builds that same image.
 * Requires `E2B_API_KEY` in the environment (or in `.env`, auto-loaded by Bun).
 */
import { Template, defaultBuildLogger, type BuildInfo } from "e2b";

import {
  IMAGE_KEYS,
  TEMPLATES,
  TEMPLATE_KEYS,
  imageKeyFor,
  isTemplateKey,
  type TemplateKey,
} from "@/worker/templates/registry";

interface Args {
  keys: TemplateKey[];
  skipCache: boolean;
  nameOverride?: string;
}

function parseArgs(argv: string[]): Args {
  let key: TemplateKey | undefined;
  let skipCache = false;
  let all = false;
  let nameOverride: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--key" || arg === "-k") {
      const value = argv[++i];
      if (!value) throw new Error("--key requires a value");
      if (!isTemplateKey(value)) {
        throw new Error(
          `Unknown template key "${value}". Valid keys: ${TEMPLATE_KEYS.join(", ")}`,
        );
      }
      key = value;
    } else if (arg === "--name" || arg === "-n") {
      const value = argv[++i];
      if (!value) throw new Error("--name requires a value");
      nameOverride = value;
    } else if (arg === "--skip-cache") {
      skipCache = true;
    } else if (arg === "--all") {
      all = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (nameOverride && !key) {
    throw new Error("--name can only be used together with a single --key");
  }
  if (key && all) {
    throw new Error("Pass either --key or --all, not both");
  }
  if (!key && !all) {
    throw new Error(
      `Pass --key <key> to build one template (valid keys: ${TEMPLATE_KEYS.join(", ")}), or --all to rebuild every one — including the generation-1 images existing projects boot from.`,
    );
  }

  return {
    // Per image, not per key: the three v2-* levels are one image.
    keys: key ? [imageKeyFor(key)] : [...IMAGE_KEYS],
    skipCache,
    nameOverride,
  };
}

async function buildOne(
  key: TemplateKey,
  name: string,
  skipCache: boolean,
): Promise<void> {
  const template = await TEMPLATES[key].load();

  console.log(
    `\nBuilding E2B template "${name}" (key: ${key})${skipCache ? " (cache disabled)" : ""}…\n`,
  );

  // `Template.build` streams the remote build (running every .runCmd step in
  // the definition) and resolves once the image is published.
  const info: BuildInfo = await Template.build(template, name, {
    skipCache,
    // Increased memory for e2e apps.
    cpuCount: 2,
    memoryMB: 2048,
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

async function main(): Promise<void> {
  if (!process.env.E2B_API_KEY) {
    console.error(
      "E2B_API_KEY is not set — add it to worker-service/.env or export it before running.",
    );
    process.exit(1);
  }

  const { keys, skipCache, nameOverride } = parseArgs(process.argv.slice(2));

  for (const key of keys) {
    const name = nameOverride ?? TEMPLATES[key].e2bName;
    await buildOne(key, name, skipCache);
  }

  console.log(`\nDone — built ${keys.length} template(s).`);
}

main().catch((err: unknown) => {
  console.error("\n✗ Template build failed:", err);
  process.exit(1);
});
