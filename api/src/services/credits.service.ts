import {
  getBalance,
  redeem,
  PromoCodeInvalidError,
  PromoCodeExpiredError,
  PromoCodeAlreadyRedeemedError,
} from "../lib/credits";
import { toCredits } from "../lib/pricing";
import { Errors } from "../lib/errors";
import * as creditsRepo from "../repositories/credits.repository";
import type { CreatePromoCodeInput } from "../repositories/credits.repository";

// Credit amounts are stored as integer micro-credits (BigInt). Express can't
// JSON-serialize BigInt, so every response exposes both a human `credits` number
// (lossy, for display) and the exact `*Micro` string.

export async function getBalanceSummary(userId: string) {
  // getBalance applies any pending daily free refill, then returns the buckets.
  const view = await getBalance(userId);
  const account = await creditsRepo.findAccount(userId);

  return {
    plan: account?.plan ?? "FREE",
    cycleEnd: account?.cycleEnd ?? null,
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

export async function redeemCode(userId: string, rawCode: string) {
  let result;
  try {
    result = await redeem(userId, rawCode);
  } catch (err) {
    if (err instanceof PromoCodeInvalidError) throw Errors.badRequest(err.message);
    if (err instanceof PromoCodeExpiredError) throw Errors.gone(err.message);
    if (err instanceof PromoCodeAlreadyRedeemedError) throw Errors.conflict(err.message);
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
  const { entries, nextCursor } = await creditsRepo.listLedger(userId, opts);

  return {
    entries: entries.map((e) => ({
      id: e.id,
      type: e.type,
      credits: toCredits(e.amount),
      amountMicro: e.amount.toString(),
      balanceAfter: toCredits(e.balanceAfter),
      balanceAfterMicro: e.balanceAfter.toString(),
      reason: e.reason,
      jobId: e.jobId,
      createdAt: e.createdAt,
    })),
    nextCursor,
  };
}
