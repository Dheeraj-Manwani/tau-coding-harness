// Verification aid for Tau Cloud Storage S1 (before `enable_storage` exists).
//   bun run scripts/mint-storage-key.ts <projectId> [PREVIEW|LIVE]
// Prints a storage key for the project's owner. Treat the output as a secret.
import { prisma } from "@/lib/prisma";
import { ensureStorageKey } from "@/lib/storageKeys";

const [projectId, envArg = "PREVIEW"] = process.argv.slice(2);
if (!projectId || (envArg !== "PREVIEW" && envArg !== "LIVE")) {
  console.error("usage: bun run scripts/mint-storage-key.ts <projectId> [PREVIEW|LIVE]");
  process.exit(1);
}

const project = await prisma.project.findUnique({ where: { id: projectId }, select: { userId: true } });
if (!project) {
  console.error("no such project");
  process.exit(1);
}
const { key } = await ensureStorageKey(projectId, project.userId, envArg);
console.log(key);
await prisma.$disconnect();
