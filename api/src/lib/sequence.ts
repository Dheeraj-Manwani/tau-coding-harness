import type { Prisma } from "../generated/prisma/client";

export async function getNextSequence(
  tx: Prisma.TransactionClient,
  projectId: string,
): Promise<number> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${projectId}))`;

  const rows = await tx.$queryRaw<{ next: number }[]>`
    SELECT COALESCE(MAX("sequence"), -1) + 1 AS next
    FROM "Message"
    WHERE "projectId" = ${projectId}
  `;

  return Number(rows[0]?.next ?? 0);
}
