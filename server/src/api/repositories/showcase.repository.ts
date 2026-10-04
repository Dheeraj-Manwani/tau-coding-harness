import { prisma } from "@/lib/prisma";

export const SHOWCASE_MIN_TURNS = 3;
export const SHOWCASE_RECENT_DAYS = 90;
export const SHOWCASE_LIMIT = 6;

/** Only the currently served deployment qualifies, never an old successful build. */
export function findShowcaseSites(userId: string, now = new Date(), client: Pick<typeof prisma, "$queryRaw"> = prisma) {
  const since = new Date(now.getTime() - SHOWCASE_RECENT_DAYS * 86_400_000);
  return client.$queryRaw<{ slug: string }[]>`
    SELECT p."slug"
    FROM "Project" p
    JOIN "Deployment" d ON d."id" = p."liveDeploymentId" AND d."projectId" = p."id"
    JOIN LATERAL (
      SELECT COUNT(*) AS turns FROM "Message" m
      WHERE m."projectId" = p."id" AND m."role" = 'USER' AND m."type" = 'USER'
    ) activity ON activity.turns >= ${SHOWCASE_MIN_TURNS}
    WHERE p."userId" <> ${userId} AND p."slug" IS NOT NULL
      AND d."status" = 'READY' AND d."purgedAt" IS NULL
      AND d."error" IS NULL AND d."fileCount" > 0 AND d."completedAt" >= ${since}
    ORDER BY activity.turns DESC, d."completedAt" DESC, p."id" ASC
    LIMIT ${SHOWCASE_LIMIT}
  `;
}
