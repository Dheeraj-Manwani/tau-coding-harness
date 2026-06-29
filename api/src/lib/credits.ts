import { prisma } from "./prisma";
import type { Prisma } from "../generated/prisma/client";
import { HoldStatus, LedgerType } from "../generated/prisma/enums";
import {
  FREE_DAILY_ALLOTMENT_MICRO,
  PRO_MONTHLY_ALLOTMENT_MICRO,
  JOB_RESERVE_CEILING_MICRO,
  MIN_SPEND_TO_START_MICRO,
  costMicro,
  spendBuckets,
} from "./pricing";

type Tx = Prisma.TransactionClient;

/** Emit a structured JSON log line for every credit mutation. */
function creditLog(event: string, fields: Record<string, unknown>): void {
  console.log(
    JSON.stringify({ ts: new Date().toISOString(), event, ...fields }),
  );
}

export class InsufficientCreditsError extends Error {
  readonly code = "INSUFFICIENT_CREDITS";
  constructor(message = "Insufficient credits") {
    super(message);
    this.name = "InsufficientCreditsError";
  }
}

export class PromoCodeInvalidError extends Error {
  readonly code = "PROMO_CODE_INVALID";
  constructor(msg = "Invalid or inactive promo code") {
    super(msg);
    this.name = "PromoCodeInvalidError";
  }
}

export class PromoCodeExpiredError extends Error {
  readonly code = "PROMO_CODE_EXPIRED";
  constructor(msg = "Promo code has expired") {
    super(msg);
    this.name = "PromoCodeExpiredError";
  }
}

export class PromoCodeAlreadyRedeemedError extends Error {
  readonly code = "PROMO_CODE_ALREADY_REDEEMED";
  constructor(msg = "Code already redeemed by this account") {
    super(msg);
    this.name = "PromoCodeAlreadyRedeemedError";
  }
}

interface AccountRow {
  userId: string;
  freeBalance: bigint;
  planBalance: bigint;
  bonusBalance: bigint;
  reserved: bigint;
  dailyAllotment: bigint;
  freeRefilledAt: Date | null;
}

export interface BalanceView {
  freeBalance: bigint;
  planBalance: bigint;
  bonusBalance: bigint;
  reserved: bigint;
  /** gross = free + plan + bonus */
  gross: bigint;
  /** available = gross − reserved */
  available: bigint;
}

function utcDayStart(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

function gross(a: {
  freeBalance: bigint;
  planBalance: bigint;
  bonusBalance: bigint;
}): bigint {
  return a.freeBalance + a.planBalance + a.bonusBalance;
}

function view(a: AccountRow): BalanceView {
  const g = gross(a);
  return {
    freeBalance: a.freeBalance,
    planBalance: a.planBalance,
    bonusBalance: a.bonusBalance,
    reserved: a.reserved,
    gross: g,
    available: g - a.reserved,
  };
}

/** Lock the account row for update, then read it via the typed client. */
async function lockAccount(tx: Tx, userId: string): Promise<AccountRow> {
  await tx.$executeRaw`SELECT 1 FROM "BillingAccount" WHERE "userId" = ${userId} FOR UPDATE`;
  const acc = await tx.billingAccount.findUnique({ where: { userId } });
  if (!acc) throw new Error(`BillingAccount missing for user ${userId}`);
  return acc;
}

/**
 * Idempotent: ensure a FREE account exists with the daily bucket pre-filled.
 * Called at signup and lazily before the first spend.
 */
export async function ensureBillingAccount(
  userId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
) {
  return client.billingAccount.upsert({
    where: { userId },
    update: {},
    create: {
      userId,
      dailyAllotment: FREE_DAILY_ALLOTMENT_MICRO,
      freeBalance: FREE_DAILY_ALLOTMENT_MICRO,
      freeRefilledAt: new Date(),
    },
  });
}

/**
 * If the free bucket hasn't been refilled today (UTC), reset it to the daily
 * allotment (use-it-or-lose-it). Mutates `acc` in place and writes the account +
 * a DAILY_FREE_GRANT ledger row for the net delta. No-op otherwise.
 */
async function applyDailyRefill(
  tx: Tx,
  acc: AccountRow,
  now: Date,
): Promise<void> {
  const last = acc.freeRefilledAt ? utcDayStart(acc.freeRefilledAt) : null;
  if (last && last.getTime() >= utcDayStart(now).getTime()) return;

  const delta = acc.dailyAllotment - acc.freeBalance; // >= 0 (free maxes at allotment)
  acc.freeBalance = acc.dailyAllotment;
  acc.freeRefilledAt = now;

  await tx.billingAccount.update({
    where: { userId: acc.userId },
    data: { freeBalance: acc.freeBalance, freeRefilledAt: acc.freeRefilledAt },
  });

  if (delta !== 0n) {
    await tx.creditLedger.create({
      data: {
        userId: acc.userId,
        type: LedgerType.DAILY_FREE_GRANT,
        amount: delta,
        balanceAfter: gross(acc),
        idempotencyKey: `free:${acc.userId}:${utcDayStart(now).toISOString()}`,
        reason: "daily free refill",
      },
    });
  }
}

/** Read the live balance, applying any pending daily refill. */
export async function getBalance(userId: string): Promise<BalanceView> {
  await ensureBillingAccount(userId);
  return prisma.$transaction(async (tx) => {
    const acc = await lockAccount(tx, userId);
    await applyDailyRefill(tx, acc, new Date());
    return view(acc);
  });
}

export interface ReserveResult {
  holdId: string;
  reserved: bigint;
  available: bigint;
}

/**
 * Reserve logic that runs inside an existing Prisma interactive transaction.
 * Used by project.service.ts to make reserve+createJob atomic (so a 402 rolls
 * back the whole project creation with no orphan rows).
 */
export async function reserveInTx(
  tx: Tx,
  userId: string,
  jobId: string,
  opts: { maxConcurrentJobs?: number } = {},
): Promise<ReserveResult> {
  await ensureBillingAccount(userId, tx);
  const acc = await lockAccount(tx, userId);
  await applyDailyRefill(tx, acc, new Date());

  const existing = await tx.creditHold.findUnique({ where: { jobId } });
  if (existing && existing.status === HoldStatus.ACTIVE) {
    return {
      holdId: existing.id,
      reserved: existing.amount,
      available: gross(acc) - acc.reserved,
    };
  }

  // Concurrent-job cap: count how many ACTIVE holds the user already has.
  const maxJobs = opts.maxConcurrentJobs ?? 0;
  if (maxJobs > 0) {
    const activeCount = await tx.creditHold.count({
      where: { userId, status: HoldStatus.ACTIVE },
    });
    if (activeCount >= maxJobs) {
      throw new InsufficientCreditsError(
        `Concurrent job limit (${maxJobs}) reached`,
      );
    }
  }

  const available = gross(acc) - acc.reserved;
  if (available < MIN_SPEND_TO_START_MICRO) {
    throw new InsufficientCreditsError();
  }

  const ceiling =
    available < JOB_RESERVE_CEILING_MICRO
      ? available
      : JOB_RESERVE_CEILING_MICRO;

  await tx.billingAccount.update({
    where: { userId },
    data: { reserved: acc.reserved + ceiling },
  });
  const hold = await tx.creditHold.create({
    data: { userId, jobId, amount: ceiling, status: HoldStatus.ACTIVE },
  });

  creditLog("credits.reserve", {
    userId,
    jobId,
    ceilingMicro: ceiling.toString(),
    availableAfterMicro: (available - ceiling).toString(),
  });

  return { holdId: hold.id, reserved: ceiling, available: available - ceiling };
}

/**
 * Reserve a spending ceiling for a job. Throws InsufficientCreditsError when the
 * available balance is below the minimum to start. Idempotent per jobId (one
 * hold per job), so a re-enqueue can't double-reserve.
 */
export async function reserve(
  userId: string,
  jobId: string,
): Promise<ReserveResult> {
  return prisma.$transaction(async (tx) => reserveInTx(tx, userId, jobId));
}

export interface MeterResult {
  /** micro-credits actually debited this turn */
  debited: bigint;
  /** hold consumption after this turn (if a hold exists) */
  consumed: bigint;
  available: bigint;
  /** true when enforce=true and the job's hold ceiling has been fully consumed */
  holdExhausted: boolean;
}

export interface MeterOptions {
  /**
   * When false (shadow mode), the DEBIT ledger row is still written
   * (for calibration) but balances and holds are NOT moved. Defaults to true.
   */
  enforce?: boolean;
}

/**
 * Debit a single completion's token cost against the buckets (free→plan→bonus)
 * and the job's hold. Idempotent per (jobId, sequence) so a retried turn is not
 * double-charged. Returns the new available balance for the loop's cutoff check.
 */
export async function meter(
  userId: string,
  jobId: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  sequence: number,
  opts: MeterOptions = {},
): Promise<MeterResult> {
  const enforce = opts.enforce ?? true;
  const cost = costMicro(model, inputTokens, outputTokens);
  const idempotencyKey = `debit:${jobId}:${sequence}`;

  return prisma.$transaction(async (tx) => {
    const acc = await lockAccount(tx, userId);

    const dup = await tx.creditLedger.findUnique({ where: { idempotencyKey } });
    if (dup) {
      const existing = await tx.creditHold.findUnique({ where: { jobId } });
      return {
        debited: 0n,
        consumed: existing?.consumed ?? 0n,
        available: gross(acc) - acc.reserved,
        holdExhausted: false,
      };
    }

    const hold = await tx.creditHold.findUnique({ where: { jobId } });

    let debited: bigint;
    let newGross: bigint;
    let consumed = hold?.consumed ?? 0n;
    let holdExhausted = false;

    if (enforce) {
      const spent = spendBuckets(
        {
          free: acc.freeBalance,
          plan: acc.planBalance,
          bonus: acc.bonusBalance,
        },
        cost,
      );
      debited = spent.debited;
      newGross = spent.buckets.free + spent.buckets.plan + spent.buckets.bonus;

      await tx.billingAccount.update({
        where: { userId },
        data: {
          freeBalance: spent.buckets.free,
          planBalance: spent.buckets.plan,
          bonusBalance: spent.buckets.bonus,
        },
      });

      if (hold) {
        const updated = await tx.creditHold.update({
          where: { jobId },
          data: { consumed: { increment: debited } },
        });
        consumed = updated.consumed;
        holdExhausted = consumed >= hold.amount;
      }
    } else {
      // Shadow: record the full token cost, leave balances and holds untouched.
      debited = cost;
      newGross = gross(acc);
    }

    await tx.creditLedger.create({
      data: {
        userId,
        type: LedgerType.DEBIT,
        amount: -debited,
        balanceAfter: newGross,
        jobId,
        holdId: hold?.id,
        idempotencyKey,
        reason: enforce ? `metered ${model}` : `shadow ${model}`,
      },
    });

    const result = {
      debited,
      consumed,
      available: newGross - acc.reserved,
      holdExhausted,
    };

    creditLog("credits.meter", {
      userId,
      jobId,
      model,
      sequence,
      costMicro: cost.toString(),
      debitedMicro: debited.toString(),
      enforce,
      holdExhausted,
    });

    return result;
  });
}

/**
 * Settle a job's hold on terminal status: release the reserved ceiling (real
 * consumption already left the balance via meter()). Idempotent — a no-op if the
 * hold is already settled/released. Real token debits are kept; only the unused
 * earmark is returned.
 */
export async function settle(jobId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const hold = await tx.creditHold.findUnique({ where: { jobId } });
    if (!hold || hold.status !== HoldStatus.ACTIVE) return;

    await lockAccount(tx, hold.userId);
    await tx.billingAccount.update({
      where: { userId: hold.userId },
      data: { reserved: { decrement: hold.amount } },
    });
    await tx.creditHold.update({
      where: { jobId },
      data: { status: HoldStatus.SETTLED, settledAt: new Date() },
    });

    creditLog("credits.settle", {
      jobId,
      userId: hold.userId,
      holdAmountMicro: hold.amount.toString(),
      consumedMicro: hold.consumed.toString(),
      releasedMicro: (hold.amount - hold.consumed).toString(),
    });
  });
}

function isPrismaUniqueConstraintError(err: unknown): boolean {
  return (
    err != null &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code: unknown }).code === "P2002"
  );
}

export interface RedeemResult {
  creditsGranted: bigint;
  available: bigint;
}

/**
 * Atomically redeem a promo code for a user, crediting bonusBalance.
 * Throws domain-specific errors for invalid/expired/already-redeemed codes;
 * the caller (credits.service.ts) maps these to HTTP status codes.
 */
export async function redeem(
  userId: string,
  rawCode: string,
): Promise<RedeemResult> {
  const code = rawCode.trim().toUpperCase();
  return prisma.$transaction(async (tx) => {
    // Lock the PromoCode row to prevent concurrent over-redemption.
    await tx.$executeRaw`SELECT 1 FROM "PromoCode" WHERE code = ${code} FOR UPDATE`;
    const promo = await tx.promoCode.findUnique({ where: { code } });

    if (!promo || !promo.isActive) throw new PromoCodeInvalidError();
    if (promo.expiresAt !== null && promo.expiresAt <= new Date()) {
      throw new PromoCodeExpiredError();
    }
    if (
      promo.maxRedemptions !== null &&
      promo.redeemedCount >= promo.maxRedemptions
    ) {
      throw new PromoCodeInvalidError("Promo code has been fully redeemed");
    }

    // @@unique([codeId, userId]) — DB enforces one redemption per user.
    let redemption;
    try {
      redemption = await tx.promoRedemption.create({
        data: { codeId: promo.id, userId, creditsGranted: promo.credits },
      });
    } catch (err: unknown) {
      if (isPrismaUniqueConstraintError(err))
        throw new PromoCodeAlreadyRedeemedError();
      throw err;
    }

    await tx.promoCode.update({
      where: { id: promo.id },
      data: { redeemedCount: { increment: 1 } },
    });

    await ensureBillingAccount(userId, tx);
    const acc = await lockAccount(tx, userId);

    const newBonusBalance = acc.bonusBalance + promo.credits;
    await tx.billingAccount.update({
      where: { userId },
      data: { bonusBalance: newBonusBalance },
    });

    const newGross = acc.freeBalance + acc.planBalance + newBonusBalance;
    await tx.creditLedger.create({
      data: {
        userId,
        type: LedgerType.PROMO_REDEEM,
        amount: promo.credits,
        balanceAfter: newGross,
        promoRedemptionId: redemption.id,
        idempotencyKey: `promo:${promo.id}:${userId}`,
        reason: `promo ${code}`,
      },
    });

    return {
      creditsGranted: promo.credits,
      available: newGross - acc.reserved,
    };
  });
}

/**
 * Grant a PRO monthly plan cycle: expire any leftover planBalance from the prior
 * cycle, reset planBalance to the monthly allotment, record cycle dates, and write
 * a PLAN_GRANT ledger entry. Idempotent — a repeated call for the same
 * (subscriptionId, cycleStart) is a no-op thanks to the idempotency key.
 */
export async function grantPlanCycle(
  userId: string,
  subscriptionId: string,
  cycleStart: Date,
  cycleEnd: Date,
): Promise<void> {
  const idempotencyKey = `plan:${subscriptionId}:${cycleStart.toISOString()}`;
  await prisma.$transaction(async (tx) => {
    // Short-circuit on redelivery without taking the lock.
    const dup = await tx.creditLedger.findUnique({ where: { idempotencyKey } });
    if (dup) return;

    const acc = await lockAccount(tx, userId);

    // Expire any unused plan credits from the prior cycle (reset policy).
    if (acc.planBalance > 0n) {
      const grossAfterExpire = acc.freeBalance + 0n + acc.bonusBalance;
      await tx.creditLedger.create({
        data: {
          userId,
          type: LedgerType.EXPIRE,
          amount: -acc.planBalance,
          balanceAfter: grossAfterExpire,
          reason: "plan cycle reset — prior unused credits expired",
        },
      });
    }

    const newGross =
      acc.freeBalance + PRO_MONTHLY_ALLOTMENT_MICRO + acc.bonusBalance;
    await tx.billingAccount.update({
      where: { userId },
      data: { planBalance: PRO_MONTHLY_ALLOTMENT_MICRO, cycleStart, cycleEnd },
    });

    await tx.creditLedger.create({
      data: {
        userId,
        type: LedgerType.PLAN_GRANT,
        amount: PRO_MONTHLY_ALLOTMENT_MICRO,
        balanceAfter: newGross,
        idempotencyKey,
        reason: "monthly PRO plan grant",
      },
    });

    creditLog("credits.plan_grant", {
      userId,
      subscriptionId,
      amountMicro: PRO_MONTHLY_ALLOTMENT_MICRO.toString(),
      cycleStart: cycleStart.toISOString(),
      cycleEnd: cycleEnd.toISOString(),
    });
  });
}

// ── C7: Reconciliation & sweep ────────────────────────────────────────────────

export interface ReconcileAccountResult {
  userId: string;
  ok: boolean;
  /** Difference between stored (free+plan+bonus) and Σ ledger.amount. */
  grossDriftMicro: string;
  /** Difference between stored reserved and Σ ACTIVE hold.amount. */
  reservedDriftMicro: string;
  actualGrossMicro: string;
  ledgerSumMicro: string;
  actualReservedMicro: string;
  activeHoldSumMicro: string;
}

/** Assert that stored balances match the ledger/hold sums. Emits a log on drift. */
export async function reconcileAccount(
  userId: string,
): Promise<ReconcileAccountResult> {
  const [account, ledgerAgg, holdAgg] = await Promise.all([
    prisma.billingAccount.findUnique({ where: { userId } }),
    prisma.creditLedger.aggregate({ where: { userId }, _sum: { amount: true } }),
    prisma.creditHold.aggregate({
      where: { userId, status: HoldStatus.ACTIVE },
      _sum: { amount: true },
    }),
  ]);

  if (!account) {
    return {
      userId,
      ok: false,
      grossDriftMicro: "0",
      reservedDriftMicro: "0",
      actualGrossMicro: "0",
      ledgerSumMicro: "0",
      actualReservedMicro: "0",
      activeHoldSumMicro: "0",
    };
  }

  const actualGross =
    account.freeBalance + account.planBalance + account.bonusBalance;
  const ledgerSum = ledgerAgg._sum.amount ?? 0n;
  const actualReserved = account.reserved;
  const activeHoldSum = holdAgg._sum.amount ?? 0n;
  const grossDrift = actualGross - ledgerSum;
  const reservedDrift = actualReserved - activeHoldSum;

  if (grossDrift !== 0n || reservedDrift !== 0n) {
    creditLog("credits.drift_detected", {
      userId,
      grossDriftMicro: grossDrift.toString(),
      reservedDriftMicro: reservedDrift.toString(),
    });
  }

  return {
    userId,
    ok: grossDrift === 0n && reservedDrift === 0n,
    grossDriftMicro: grossDrift.toString(),
    reservedDriftMicro: reservedDrift.toString(),
    actualGrossMicro: actualGross.toString(),
    ledgerSumMicro: ledgerSum.toString(),
    actualReservedMicro: actualReserved.toString(),
    activeHoldSumMicro: activeHoldSum.toString(),
  };
}

export interface ReconcileJobResult {
  jobId: string;
  /** Σ costMicro(TokenUsage) === Σ |DEBIT ledger.amount| for this job. */
  ok: boolean;
  chargedMicro: string;
  tokenCostMicro: string;
  driftMicro: string;
}

/** Cross-check: actual ledger debits for a job vs. recomputed TokenUsage cost. */
export async function reconcileJob(
  jobId: string,
): Promise<ReconcileJobResult> {
  const [debitAgg, tokenRows] = await Promise.all([
    prisma.creditLedger.aggregate({
      where: { jobId, type: LedgerType.DEBIT },
      _sum: { amount: true },
    }),
    prisma.tokenUsage.findMany({ where: { jobId } }),
  ]);

  const chargedMicro = -(debitAgg._sum.amount ?? 0n); // debits are stored negative
  const tokenCostMicro = tokenRows.reduce(
    (sum, row) => sum + costMicro(row.model, row.inputTokens, row.outputTokens),
    0n,
  );
  const driftMicro = chargedMicro - tokenCostMicro;

  return {
    jobId,
    ok: driftMicro === 0n,
    chargedMicro: chargedMicro.toString(),
    tokenCostMicro: tokenCostMicro.toString(),
    driftMicro: driftMicro.toString(),
  };
}

/** Settle any ACTIVE holds whose jobs have already reached a terminal state. */
export async function sweepStuckHolds(): Promise<{
  swept: number;
  errors: string[];
}> {
  // CreditHold has no Prisma relation to Job, so we use a raw join.
  const stuckRows = await prisma.$queryRaw<{ jobId: string }[]>`
    SELECT ch."jobId"
    FROM "CreditHold" ch
    JOIN "Job" j ON j.id = ch."jobId"
    WHERE ch.status = 'ACTIVE'
    AND j.status IN ('COMPLETED', 'FAILED', 'CANCELLED')
  `;

  const errors: string[] = [];
  for (const row of stuckRows) {
    try {
      await settle(row.jobId);
    } catch (err) {
      errors.push(
        `${row.jobId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const swept = stuckRows.length - errors.length;
  if (stuckRows.length > 0) {
    creditLog("credits.sweep", {
      found: stuckRows.length,
      swept,
      errorCount: errors.length,
    });
  }

  return { swept, errors };
}
