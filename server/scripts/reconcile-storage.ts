// Compare the storage bucket with the StorageObject table.
//   bun run scripts/reconcile-storage.ts          report only
//   bun run scripts/reconcile-storage.ts --fix    delete orphaned objects and dead rows
// Needs R2_STORAGE_BUCKET and the database. See ops/README.md, "File storage".
import { prisma } from "@/lib/prisma";
import { storageConfigured } from "@/lib/storageBucket";
import { reconcileStorage } from "@/lib/reconcileStorage";

if (!storageConfigured()) {
  console.error("R2_STORAGE_BUCKET is not set.");
  process.exit(1);
}

const fix = process.argv.includes("--fix");
const result = await reconcileStorage({ fix });

console.log(`checked ${result.checkedObjects} objects and ${result.checkedRows} rows`);
console.log(`objects with no row: ${result.orphanObjects.length}`);
for (const k of result.orphanObjects.slice(0, 50)) console.log(`  ${k}`);
console.log(`READY rows with no object: ${result.missingObjects.length}`);
for (const r of result.missingObjects.slice(0, 50)) console.log(`  ${r.projectId} ${r.env} ${r.key} (${r.id})`);
if (result.fixed) {
  console.log(`fixed: ${result.fixed.objectsDeleted} objects deleted, ${result.fixed.rowsDeleted} rows deleted`);
} else if (result.orphanObjects.length + result.missingObjects.length > 0) {
  console.log("report only; run with --fix to clean up");
}
await prisma.$disconnect();
