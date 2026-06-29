import { prisma } from "../lib/prisma";
import type { CreditLedger } from "../generated/prisma/client";
import { MICRO } from "../lib/pricing";

export function findAccount(userId: string) {
  return prisma.billingAccount.findUnique({
    where: { userId },
    select: { plan: true, cycleEnd: true, dailyAllotment: true },
  });
}

export async function listLedger(
  userId: string,
  opts: { cursor?: string; limit: number },
): Promise<{ entries: CreditLedger[]; nextCursor: string | null }> {
  const rows = await prisma.creditLedger.findMany({
    where: { userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: opts.limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > opts.limit;
  const entries = hasMore ? rows.slice(0, opts.limit) : rows;
  const nextCursor = hasMore ? (entries.at(-1)?.id ?? null) : null;
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
