import {
  getBalance,
  redeem,
  PromoCodeInvalidError,
  PromoCodeExpiredError,
  PromoCodeAlreadyRedeemedError,
} from "../lib/credits";
import { toCredits, reserveCeilingForEffort } from "../lib/pricing";
import { Errors } from "../lib/errors";
import type { Effort } from "../generated/prisma/enums";
import * as creditsRepo from "../repositories/credits.repository";
import type { CreatePromoCodeInput } from "../repositories/credits.repository";

// Credit amounts are stored as integer micro-credits (BigInt). Express can't
// JSON-serialize BigInt, so every response exposes both a human `credits` number
// (lossy, for display) and the exact `*Micro` string.

const EFFORT_CEILINGS: Record<Effort, number> = {
  LOW: toCredits(reserveCeilingForEffort("LOW")),
  HIGH: toCredits(reserveCeilingForEffort("HIGH")),
  MAX: toCredits(reserveCeilingForEffort("MAX")),
};

export async function getBalanceSummary(userId: string) {
  // getBalance ensures the account (and its one-time signup grant) exists.
  const view = await getBalance(userId);
  const account = await creditsRepo.findAccount(userId);

  return {
    plan: account?.plan ?? "FREE",
    cycleEnd: account?.cycleEnd ?? null,
    effortCeilings: EFFORT_CEILINGS,
    credits: {
      available: toCredits(view.available),
      free: toCredits(view.freeBalance),
      plan: toCredits(view.planBalance),
      bonus: toCredits(view.bonusBalance),
      reserved: toCredits(view.reserved),
    },
    micro: {
      available: view.available.toString(),
      free: view.freeBalance.toString(),
      plan: view.planBalance.toString(),
      bonus: view.bonusBalance.toString(),
      reserved: view.reserved.toString(),
    },
  };
}

/**
 * Where the credits went: building, versus apps calling AI at runtime.
 *
 * Read from `CreditLedger`, not by summing `TokenUsage` and `GatewayUsage`.
 * The ledger is the money record — it is what `reconcileAccount()` checks the
 * gross against — and `LedgerType.GATEWAY_DEBIT` exists precisely so this split
 * is a `where` rather than a string match on `reason`. The usage tables are
 * token counts, which is a different question and answered separately below.
 *
 * Runtime spend was previously invisible here: every rollup read `TokenUsage`
 * only, so a user whose deployed app burned credits saw the balance drop with
 * nothing explaining it.
 */
export async function getSpendSummary(userId: string) {
  const since = new Date(Date.now() - 30 * 86_400_000);

  const [byType, gateway, byAlias] = await Promise.all([
    creditsRepo.sumSpendByType(userId, since),
    creditsRepo.gatewayUsageTotals(userId, since),
    creditsRepo.gatewayUsageByAlias(userId, since),
  ]);

  const build = byType.get("DEBIT") ?? 0n;
  const runtime = byType.get("GATEWAY_DEBIT") ?? 0n;

  return {
    windowDays: 30,
    since: since.toISOString(),
    build: {
      credits: toCredits(build),
      microCredits: build.toString(),
    },
    runtime: {
      credits: toCredits(runtime),
      microCredits: runtime.toString(),
      requests: gateway.requests,
      inputTokens: gateway.inputTokens,
      outputTokens: gateway.outputTokens,
      byModel: byAlias.map((row) => ({
        alias: row.alias,
        requests: row.requests,
        credits: toCredits(row.costMicro),
      })),
    },
    total: {
      credits: toCredits(build + runtime),
      microCredits: (build + runtime).toString(),
    },
  };
}

export async function redeemCode(userId: string, rawCode: string) {
  let result;
  try {
    result = await redeem(userId, rawCode);
  } catch (err) {
    if (err instanceof PromoCodeInvalidError)
      throw Errors.badRequest(err.message);
    if (err instanceof PromoCodeExpiredError) throw Errors.gone(err.message);
    if (err instanceof PromoCodeAlreadyRedeemedError)
      throw Errors.conflict(err.message);
    throw err;
  }
  return {
    creditsGranted: toCredits(result.creditsGranted),
    creditsGrantedMicro: result.creditsGranted.toString(),
    available: toCredits(result.available),
    availableMicro: result.available.toString(),
  };
}

export async function createPromoCode(input: CreatePromoCodeInput) {
  const promo = await creditsRepo.createPromoCode(input);
  return {
    id: promo.id,
    code: promo.code,
    credits: toCredits(promo.credits),
    creditsMicro: promo.credits.toString(),
    description: promo.description,
    maxRedemptions: promo.maxRedemptions,
    perUserLimit: promo.perUserLimit,
    expiresAt: promo.expiresAt,
    createdAt: promo.createdAt,
  };
}

export async function getHistory(
  userId: string,
  opts: { cursor?: string; limit: number },
) {
  const { entries, nextCursor } = await creditsRepo.listActivity(userId, opts);

  return {
    entries: entries.map((e) => ({
      id: e.id,
      type: e.type,
      credits: toCredits(e.amountMicro),
      amountMicro: e.amountMicro.toString(),
      balanceAfter: toCredits(e.balanceAfterMicro),
      balanceAfterMicro: e.balanceAfterMicro.toString(),
      reason: e.reason,
      jobId: e.jobId,
      projectName: e.projectName,
      turnCount: e.turnCount,
      createdAt: e.createdAt,
    })),
    nextCursor,
  };
}
