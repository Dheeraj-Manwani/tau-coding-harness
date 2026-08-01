/**
 * Find and remove credential-shaped files that were persisted into the
 * `ProjectFile` manifest before the deny-list existed, and report which of them
 * have already been pushed to GitHub.
 *
 *   bun run scripts/remediate-leaked-secrets.ts                 # dry run — prints, deletes nothing
 *   bun run scripts/remediate-leaked-secrets.ts --confirm       # delete the rows + orphaned blobs
 *   bun run scripts/remediate-leaked-secrets.ts --json=out.json # machine-readable report
 *
 * Background: `buildProjectTree` committed every `ProjectFile` row with no
 * `.gitignore` filtering, so any secret the agent wrote into a persisted file
 * went to the user's repository. The fix (`isSecretPath` at persist time +
 * `filterPushableFiles` at push time) stops new ones. This closes out the rows
 * already in the table. See doc/AI_FOR_GENERATED_APPS.md §7.1.
 *
 * THE IMPORTANT PART IS THE REPORT, NOT THE DELETE. Deleting a `ProjectFile`
 * row does not unpush anything. A project with `githubRepo != null` and a
 * secret-shaped row has, in all likelihood, already published it — those users
 * need to be told to rotate whatever was in the file. Rewriting someone's git
 * history is not ours to do.
 *
 * This script never prints or logs file *contents* — only paths and sizes.
 * Dumping the secrets we're cleaning up into a terminal scrollback would defeat
 * the point.
 */
import "@/load-env";

import { deleteKeys, blobKey } from "@/lib/s3";
import { prisma } from "@/lib/prisma";
import { isSecretPath } from "@/api/lib/projectFiles";

const argv = process.argv.slice(2);
const args = new Set(argv);
const confirm = args.has("--confirm");
const jsonPath = argv
  .find((a) => a.startsWith("--json="))
  ?.slice("--json=".length);

function log(msg = ""): void {
  console.log(msg);
}

interface Finding {
  fileId: string;
  path: string;
  sizeBytes: number;
  contentHash: string;
}

interface ProjectReport {
  projectId: string;
  projectName: string;
  userId: string;
  userEmail: string;
  /** "owner/repo" when the project has been linked to GitHub, else null. */
  githubRepo: string | null;
  /** True when the secret has almost certainly already been committed. */
  alreadyPushed: boolean;
  findings: Finding[];
}

async function collect(): Promise<ProjectReport[]> {
  // isSecretPath is regex-based and lives in TS, so filter in memory rather
  // than trying to express it as SQL. The manifest is small enough (one row per
  // file per project) that this is a single scan, and correctness here matters
  // more than avoiding a full read.
  const rows = await prisma.projectFile.findMany({
    select: {
      id: true,
      path: true,
      sizeBytes: true,
      contentHash: true,
      projectId: true,
      project: {
        select: {
          name: true,
          userId: true,
          githubRepo: true,
          lastPushedSequence: true,
          user: { select: { email: true } },
        },
      },
    },
    orderBy: { path: "asc" },
  });

  const byProject = new Map<string, ProjectReport>();
  for (const row of rows) {
    if (!isSecretPath(row.path)) continue;

    let report = byProject.get(row.projectId);
    if (!report) {
      report = {
        projectId: row.projectId,
        projectName: row.project.name,
        userId: row.project.userId,
        userEmail: row.project.user.email,
        githubRepo: row.project.githubRepo,
        // A repo link is only created by a successful push, and a push commits
        // the whole manifest — so a linked repo plus a secret row means it went
        // out. `lastPushedSequence` is not a reliable discriminator here: the
        // file may predate or postdate it and we push everything either way.
        alreadyPushed: row.project.githubRepo !== null,
        findings: [],
      };
      byProject.set(row.projectId, report);
    }
    report.findings.push({
      fileId: row.id,
      path: row.path,
      sizeBytes: row.sizeBytes,
      contentHash: row.contentHash,
    });
  }

  return [...byProject.values()].sort((a, b) =>
    Number(b.alreadyPushed) - Number(a.alreadyPushed) ||
    a.projectId.localeCompare(b.projectId),
  );
}

/**
 * R2 blobs are content-addressed and deduped per project, so a hash may still
 * be referenced by a file we are keeping (two empty files share a hash). Only
 * collect blobs no surviving row in the same project points at.
 */
async function orphanedBlobKeys(reports: ProjectReport[]): Promise<string[]> {
  const keys: string[] = [];

  for (const report of reports) {
    const doomed = new Set(report.findings.map((f) => f.fileId));
    const survivors = await prisma.projectFile.findMany({
      where: {
        projectId: report.projectId,
        id: { notIn: [...doomed] },
      },
      select: { contentHash: true },
    });
    const stillReferenced = new Set(survivors.map((s) => s.contentHash));

    for (const hash of new Set(report.findings.map((f) => f.contentHash))) {
      if (stillReferenced.has(hash)) continue;
      keys.push(blobKey(report.userId, report.projectId, hash));
    }
  }

  return keys;
}

function printReport(reports: ProjectReport[]): void {
  const fileCount = reports.reduce((n, r) => n + r.findings.length, 0);
  const exposed = reports.filter((r) => r.alreadyPushed);

  log();
  log(
    `Found ${fileCount} credential-shaped file(s) across ${reports.length} project(s).`,
  );

  if (reports.length === 0) return;

  log();
  for (const r of reports) {
    const marker = r.alreadyPushed ? "!! PUSHED" : "   local ";
    log(`${marker}  ${r.projectName}  (${r.projectId})`);
    log(`            ${r.userEmail}`);
    if (r.githubRepo) log(`            github: ${r.githubRepo}`);
    for (const f of r.findings) {
      log(`            - ${f.path}  (${f.sizeBytes} bytes)`);
    }
  }

  if (exposed.length > 0) {
    log();
    log(
      "  ─────────────────────────────────────────────────────────────────────",
    );
    log(
      `  ${exposed.length} project(s) marked !! PUSHED are linked to a GitHub repo.`,
    );
    log(
      "  Deleting the manifest row does NOT remove the file from that repo, and",
    );
    log(
      "  it may be public. These users must be told to ROTATE whatever secrets",
    );
    log("  those files held. Affected accounts:");
    log();
    for (const r of exposed) {
      log(`    ${r.userEmail}  →  ${r.githubRepo}`);
    }
    log(
      "  ─────────────────────────────────────────────────────────────────────",
    );
  }
}

async function main(): Promise<void> {
  log(confirm ? "MODE: --confirm (will delete)" : "MODE: dry run");

  const reports = await collect();
  printReport(reports);

  if (jsonPath) {
    await Bun.write(jsonPath, JSON.stringify(reports, null, 2));
    log();
    log(`Wrote report to ${jsonPath}`);
  }

  if (reports.length === 0) {
    await prisma.$disconnect();
    return;
  }

  const blobs = await orphanedBlobKeys(reports);
  log();
  log(`${blobs.length} R2 blob(s) would be orphaned by the delete.`);

  if (!confirm) {
    log();
    log("Dry run — nothing deleted. Re-run with --confirm to apply.");
    await prisma.$disconnect();
    return;
  }

  // Rows first: a row with no blob renders as an empty file, which is ugly but
  // harmless. A blob with no row is unreachable but still sitting in R2. If we
  // crash between the two, the leftover is the harmless direction.
  const ids = reports.flatMap((r) => r.findings.map((f) => f.fileId));
  const { count } = await prisma.projectFile.deleteMany({
    where: { id: { in: ids } },
  });
  log(`Deleted ${count} ProjectFile row(s).`);

  if (blobs.length > 0) {
    const { deleted, errors } = await deleteKeys(blobs);
    for (const e of errors) console.error(`  ! ${e.key}: ${e.message}`);
    log(`Deleted ${deleted} R2 blob(s).`);
  }

  log();
  log("Done. The report above still stands: notify the !! PUSHED accounts.");
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
