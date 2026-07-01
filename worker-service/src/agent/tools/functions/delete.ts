import type Sandbox from "e2b";
import { asString, toRelativePath } from "./utils";
import { prisma } from "@/lib/prisma";
import { allocateHeadSequence } from "@/lib/headSequence";
import { publish } from "@/lib/publish";

export async function deleteFile(
  input: unknown,
  sandbox: Sandbox,
  jobId: string,
  projectId: string,
  indexer: () => number,
) {
  const p = asString((input as { path?: unknown }).path, "path");
  const relPath = toRelativePath(p);
  await sandbox.files.remove(p);

  // Invariant 3: remove manifest row + bump headSequence in one tx; blob is left untouched.
  const existing = await prisma.projectFile.findUnique({
    where: { projectId_path: { projectId, path: relPath } },
    select: { id: true },
  });

  if (existing) {
    const seq = await prisma.$transaction(async (tx) => {
      await tx.projectFile.delete({
        where: { projectId_path: { projectId, path: relPath } },
      });
      return allocateHeadSequence(tx, projectId);
    });
    await publish(
      jobId,
      { type: "file_delete", path: relPath, headSequence: seq },
      indexer(),
    );
  }

  return { success: true, path: p };
}
