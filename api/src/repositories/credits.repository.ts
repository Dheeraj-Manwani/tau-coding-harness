import { prisma } from "../lib/prisma";
import { MICRO } from "../lib/pricing";

export function findAccount(userId: string) {
  return prisma.billingAccount.findUnique({
    where: { userId },
    select: { plan: true, cycleEnd: true },
  });
}

export interface ActivityEntry {
  /** activity_id — a real CreditLedger row id, usable as the keyset cursor. */
  id: string;
  type: string;
  amountMicro: bigint;
  balanceAfterMicro: bigint;
  createdAt: Date;
  /** DEBIT rows for one generation collapse into a single activity; this is the
   *  number of metered turns that were folded in (1 for non-generation rows). */
  turnCount: number;
  jobId: string | null;
  /** Name of the project the generation belonged to; null if the project (and
   *  its jobs) were since deleted — the ledger row itself has no FK, so it
   *  survives, but the human label is lost. */
  projectName: string | null;
  reason: string | null;
}

interface ActivityRaw {
  activity_id: string;
  type: string;
  amount: bigint;
  balance_after: bigint;
  sort_time: Date;
  turn_count: number;
  job_id: string | null;
  reason: string | null;
}

/**
 * Read the ledger as a human-meaningful activity feed: the many per-turn DEBIT
 * rows of one generation collapse into a single row (summed cost, turn count,
 * and the balance after the last turn), while every other ledger type stays
 * one-row-per-event. Keyset-paginated by (time, id) so a generation's turns can
 * never straddle a page boundary and get split.
 */
export async function listActivity(
  userId: string,
  opts: { cursor?: string; limit: number },
): Promise<{ entries: ActivityEntry[]; nextCursor: string | null }> {
  // The cursor is the last activity's id (a real ledger row). Its createdAt is
  // that activity's sort_time (for a collapsed generation, the latest turn), so
  // we can rebuild the keyset comparison tuple from it.
  let cursorTime: Date | null = null;
  if (opts.cursor) {
    const row = await prisma.creditLedger.findFirst({
      where: { id: opts.cursor, userId },
      select: { createdAt: true },
    });
    cursorTime = row?.createdAt ?? null;
  }
  const cursorId = opts.cursor ?? null;

  const rows = await prisma.$queryRaw<ActivityRaw[]>`
    WITH grouped AS (
      SELECT
        (ARRAY_AGG(cl.id ORDER BY cl."createdAt" DESC, cl.id DESC))[1] AS activity_id,
        'DEBIT'::text AS type,
        SUM(cl.amount)::bigint AS amount,
        (ARRAY_AGG(cl."balanceAfter" ORDER BY cl."createdAt" DESC, cl.id DESC))[1] AS balance_after,
        MAX(cl."createdAt") AS sort_time,
        COUNT(*)::int AS turn_count,
        cl."jobId" AS job_id,
        NULL::text AS reason
      FROM "CreditLedger" cl
      WHERE cl."userId" = ${userId}
        AND cl.type = 'DEBIT'
        AND cl."jobId" IS NOT NULL
      GROUP BY cl."jobId"
    ),
    singles AS (
      SELECT
        cl.id AS activity_id,
        cl.type::text AS type,
        cl.amount AS amount,
        cl."balanceAfter" AS balance_after,
        cl."createdAt" AS sort_time,
        1 AS turn_count,
        cl."jobId" AS job_id,
        cl.reason AS reason
      FROM "CreditLedger" cl
      WHERE cl."userId" = ${userId}
        AND (cl.type <> 'DEBIT' OR cl."jobId" IS NULL)
    ),
    activity AS (
      SELECT * FROM grouped
      UNION ALL
      SELECT * FROM singles
    )
    SELECT * FROM activity a
    WHERE ${cursorTime}::timestamptz IS NULL
       OR (a.sort_time, a.activity_id) < (${cursorTime}::timestamptz, ${cursorId}::text)
    ORDER BY a.sort_time DESC, a.activity_id DESC
    LIMIT ${opts.limit + 1}
  `;

  const hasMore = rows.length > opts.limit;
  const page = hasMore ? rows.slice(0, opts.limit) : rows;
  const nextCursor = hasMore ? (page.at(-1)?.activity_id ?? null) : null;

  // Resolve project names for the collapsed generations in this page.
  const jobIds = [
    ...new Set(
      page
        .filter((r) => r.type === "DEBIT" && r.job_id)
        .map((r) => r.job_id as string),
    ),
  ];
  const jobs = jobIds.length
    ? await prisma.job.findMany({
        where: { id: { in: jobIds } },
        select: { id: true, project: { select: { name: true } } },
      })
    : [];
  const projectNameByJob = new Map(
    jobs.map((j) => [j.id, j.project?.name ?? null]),
  );

  const entries: ActivityEntry[] = page.map((r) => ({
    id: r.activity_id,
    type: r.type,
    amountMicro: r.amount,
    balanceAfterMicro: r.balance_after,
    createdAt: r.sort_time,
    turnCount: r.turn_count,
    jobId: r.job_id,
    projectName: r.job_id ? (projectNameByJob.get(r.job_id) ?? null) : null,
    reason: r.reason,
  }));

  return { entries, nextCursor };
}

export interface CreatePromoCodeInput {
  code: string;
  credits: number;
  description?: string;
  maxRedemptions?: number;
  perUserLimit: number;
  expiresAt?: Date;
}

export async function createPromoCode(input: CreatePromoCodeInput) {
  const creditsMicro = BigInt(Math.round(input.credits * Number(MICRO)));
  return prisma.promoCode.create({
    data: {
      code: input.code,
      credits: creditsMicro,
      description: input.description,
      maxRedemptions: input.maxRedemptions ?? null,
      perUserLimit: input.perUserLimit,
      expiresAt: input.expiresAt ?? null,
    },
  });
}
