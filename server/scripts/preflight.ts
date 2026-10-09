/**
 * Run the publish preflight against a stored project and print the report.
 *
 *   bun run scripts/preflight.ts <projectId> [--json]
 *
 * Reads the project the way a publish would: its level from `templateKey`, its
 * `package.json` and every file under `server/` from the stored manifest, the
 * names (and sizes, never values) of its secrets, and whether AI is on. Changes
 * nothing. Exits 1 when there is a blocker, so it can gate a script.
 *
 * For use while building Phases 4 and 5; the panel does not show this yet
 * (doc/PUBLISHING.md Phase 1).
 */
import { prisma } from "@/lib/prisma";
import { getBlobText } from "@/lib/s3";
import { decryptKey, keyEncryptionConfigured } from "@/lib/apiKeys";
import { TEMPLATES, toTemplateKey } from "@/worker/templates/registry";
import { preflight, type Level } from "@/worker/lib/deployPreflight";

const projectId = process.argv[2];
const asJson = process.argv.includes("--json");
if (!projectId) {
  console.error("usage: bun run scripts/preflight.ts <projectId> [--json]");
  process.exit(2);
}

const project = await prisma.project.findUnique({
  where: { id: projectId },
  select: { id: true, name: true, userId: true, templateKey: true, aiEnabled: true },
});
if (!project) {
  console.error(`No project ${projectId}`);
  process.exit(2);
}

const template = TEMPLATES[toTemplateKey(project.templateKey)];
const level: Level = template.hasDb ? "database" : template.hasServer ? "api" : "frontend";

const rows = await prisma.projectFile.findMany({
  where: {
    projectId,
    OR: [{ path: "package.json" }, { path: { startsWith: "server/" } }],
  },
  select: { path: true, contentHash: true },
});
const files: Record<string, string> = {};
for (const row of rows) {
  try {
    files[row.path] = await getBlobText(project.userId, projectId, row.contentHash);
  } catch (err) {
    console.error(`Could not read ${row.path}: ${String(err).slice(0, 120)}`);
  }
}

const secrets = await prisma.projectSecret.findMany({
  where: { projectId },
  select: { name: true, ciphertext: true },
});
const envValueBytes: Record<string, number> = {};
if (keyEncryptionConfigured()) {
  for (const s of secrets) {
    try {
      envValueBytes[s.name] = Buffer.byteLength(decryptKey(s.ciphertext), "utf8");
    } catch {
      // Size is only an input to the 4 KB check; an estimate is used instead.
    }
  }
}

const report = preflight({
  level,
  files,
  secretNames: secrets.map((s) => s.name),
  aiEnabled: project.aiEnabled,
  envValueBytes,
});

if (asJson) {
  console.log(JSON.stringify({ project: { id: project.id, name: project.name, templateKey: project.templateKey }, ...report }, null, 2));
} else {
  console.log(`${project.name}  (${project.templateKey}, level: ${report.level})`);
  console.log(`  ${Object.keys(files).length} files read\n`);
  const show = (title: string, issues: typeof report.blockers) => {
    console.log(`${title}: ${issues.length}`);
    for (const i of issues) {
      console.log(`  - [${i.code}] ${i.message}`);
      if (i.files?.length) console.log(`      in ${i.files.join(", ")}`);
    }
  };
  show("Blockers", report.blockers);
  show("Warnings", report.warnings);
  console.log(`\nEnvironment the published app would get: ${report.env.length === 0 ? "none" : ""}`);
  for (const e of report.env) console.log(`  ${e.name}  (${e.source})`);
}

await prisma.$disconnect();
process.exit(report.blockers.length > 0 ? 1 : 0);
