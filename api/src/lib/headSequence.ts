import type { Prisma } from "../generated/prisma/client";

/**
 * Bump and return the project's file-change counter.
 *
 * Mirrors `worker-service/src/lib/headSequence.ts` — keep the two in sync (see
 * OVERVIEW.md #7, duplicated libs).
 *
 * NOTE: this is *not* `Message.sequence` (see `lib/sequence.ts`). `headSequence`
 * counts file changes and drives `ProjectFile.lastSequence` plus GitHub's
 * `unpushedChanges = headSequence - lastPushedSequence`.
 */
export async function allocateHeadSequence(
  tx: Prisma.TransactionClient,
  projectId: string,
): Promise<number> {
  const project = await tx.project.update({
    where: { id: projectId },
    data: { headSequence: { increment: 1 } },
    select: { headSequence: true },
  });
  return project.headSequence;
}
