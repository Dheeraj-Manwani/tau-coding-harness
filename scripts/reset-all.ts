/**
 * Wipe every project-owned R2 object AND every row in Postgres, so a local
 * environment goes back to "fresh install" with no orphaned blobs left behind.
 *
 * `prisma migrate reset` only clears the database — R2 keeps every file body,
 * screenshot and attachment forever, because nothing points at them anymore.
 * This script closes that gap.
 *
 *   bun run scripts/reset-all.ts                 # dry run — prints, deletes nothing
 *   bun run scripts/reset-all.ts --confirm       # actually wipes both
 *   bun run scripts/reset-all.ts --confirm --r2-only
 *   bun run scripts/reset-all.ts --confirm --db-only
 *
 * `--all-objects` empties the whole bucket rather than just the `tau/` prefix.
 * R2_BUCKET is not necessarily tau-only, so that one additionally makes you
 * name the bucket: `--all-objects --bucket=<R2_BUCKET>`.
 *
 * Dry run is the default on purpose: this is irreversible and there is no undo.
 */
import "../deploy/load-env";

import { deleteKeys, listKeys } from "../api/src/lib/s3";
import { prisma } from "../api/src/lib/prisma";
import { env } from "../api/src/lib/env";

// Everything the app writes lives under this prefix:
//   tau/project-files/{userId}/{projectId}/{hash}
//   tau/project-files/{userId}/{projectId}/screenshots/latest.jpg
//   tau/attachments/{userId}/{hash}
const APP_PREFIX = "tau/";

// Prisma's own bookkeeping — truncating it would strand the schema mid-history.
const PRESERVED_TABLES = new Set(["_prisma_migrations"]);

const argv = process.argv.slice(2);
const args = new Set(argv);
const confirm = args.has("--confirm");
const r2Only = args.has("--r2-only");
const dbOnly = args.has("--db-only");
const allObjects = args.has("--all-objects");
const bucketArg = argv
  .find((a) => a.startsWith("--bucket="))
  ?.slice("--bucket=".length);

const doR2 = !dbOnly;
const doDb = !r2Only;

function log(msg: string): void {
  console.log(msg);
}

/** Refuse to run against anything that looks like production. */
function assertNotProduction(): void {
  if (env.NODE_ENV === "production") {
    console.error(
      "\n  REFUSING TO RUN: NODE_ENV=production.\n" +
        "  This script is for local/dev environments only. If you genuinely need\n" +
        "  to wipe a production bucket, do it by hand with the console open.\n",
    );
    process.exit(1);
  }
}

/**
 * `--all-objects` ignores the `tau/` prefix and empties the whole bucket. The
 * configured bucket is not necessarily tau-only (it's whatever R2_BUCKET points
 * at), so anything else living there would go with it. Make the caller name the
 * bucket out loud before we'll do that.
 */
function assertAllObjectsIsIntentional(): void {
  if (!allObjects || !confirm) return;
  if (bucketArg === env.R2_BUCKET) return;

  console.error(
    `\n  --all-objects empties the ENTIRE bucket "${env.R2_BUCKET}", not just\n` +
      `  the tau/ prefix. Anything else stored there is destroyed too.\n\n` +
      `  If that's really what you want, name the bucket explicitly:\n` +
      `    bun run scripts/reset-all.ts --confirm --all-objects --bucket=${env.R2_BUCKET}\n`,
  );
  process.exit(1);
}

/** Group keys by their top two path segments, purely so the dry run is readable. */
function summarize(keys: string[]): Map<string, number> {
  const groups = new Map<string, number>();
  for (const key of keys) {
    const group = key.split("/").slice(0, 2).join("/") || "(root)";
    groups.set(group, (groups.get(group) ?? 0) + 1);
  }
  return groups;
}

async function wipeR2(): Promise<void> {
  const prefix = allObjects ? "" : APP_PREFIX;
  log(
    `\nR2  bucket "${env.R2_BUCKET}" — prefix "${prefix || "(entire bucket)"}"`,
  );

  const keys = await listKeys(prefix);
  if (keys.length === 0) {
    log("  already empty");
    return;
  }

  for (const [group, count] of [...summarize(keys)].sort()) {
    log(`  ${String(count).padStart(6)}  ${group}/…`);
  }
  log(`  ${String(keys.length).padStart(6)}  TOTAL`);

  if (!confirm) return;

  log("  deleting…");
  const { deleted, errors } = await deleteKeys(keys, (done, total) =>
    log(`    …${done}/${total}`),
  );
  for (const e of errors) console.error(`    ! ${e.key}: ${e.message}`);
  log(`  deleted ${deleted} object(s)`);
}

/** Every user table in the public schema, minus Prisma's migration ledger. */
async function listTables(): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `;
  return rows
    .map((r) => r.tablename)
    .filter((t) => !PRESERVED_TABLES.has(t))
    .sort();
}

async function wipeDb(): Promise<void> {
  // Never print the full DATABASE_URL — it carries credentials.
  const host = (() => {
    try {
      return new URL(env.DATABASE_URL).host;
    } catch {
      return "unknown host";
    }
  })();
  log(`\nDB  postgres @ ${host}`);

  const tables = await listTables();
  if (tables.length === 0) {
    log("  no tables found — has the schema been migrated?");
    return;
  }

  for (const table of tables) {
    const [{ count }] = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT COUNT(*)::bigint AS count FROM "${table}"`,
    );
    log(`  ${String(count).padStart(6)}  ${table}`);
  }
  log(`  ${String(tables.length).padStart(6)}  TABLES (migration history kept)`);

  if (!confirm) return;

  log("  truncating…");
  // One statement so FK cycles can't deadlock us into a partial wipe. CASCADE
  // covers anything not named; RESTART IDENTITY resets sequences.
  const quoted = tables.map((t) => `"public"."${t}"`).join(", ");
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`,
  );
  log(`  truncated ${tables.length} table(s)`);
}

async function main(): Promise<void> {
  assertNotProduction();
  assertAllObjectsIsIntentional();

  log("─".repeat(64));
  log(confirm ? "  RESET — DESTRUCTIVE, NO UNDO" : "  RESET — DRY RUN");
  log("─".repeat(64));

  if (doR2) await wipeR2();
  if (doDb) await wipeDb();

  log("");
  if (confirm) {
    log("Done. Both stores are empty; the schema and migration history remain.");
  } else {
    log("Dry run — nothing was deleted.");
    log("Re-run with --confirm to actually wipe the above.");
  }
  log("");
}

main()
  .catch((err) => {
    console.error("\nreset failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
