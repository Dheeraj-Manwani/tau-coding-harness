import type { Prisma } from "../generated/prisma/client";

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
