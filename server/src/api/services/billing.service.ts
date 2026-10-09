import { syncUser } from "@/lib/edgeRegistry";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { Errors } from "../lib/errors";
import { getRazorpay } from "../lib/razorpay";
import {
  grantPlanCycle,
  grantBonusCredits,
  ensureBillingAccount,
} from "@/lib/credits";
import {
  MICRO,
  PRO_MONTHLY_ALLOTMENT_MICRO,
  PRO_MONTHLY_PRICE_INR,
  FREE_SIGNUP_GRANT_MICRO,
  toCredits,
} from "@/lib/pricing";
import type { Prisma } from "@/generated/prisma/client";
import { Plan, SubscriptionStatus } from "@/generated/prisma/enums";

// ── Static plan catalog ──────────────────────────────────────────────────────

export function getPlans() {
  return {
    plans: [
      {
        id: "FREE" as const,
        name: "Free",
        credits: toCredits(FREE_SIGNUP_GRANT_MICRO),
        resetPeriod: "one-time",
        price: null,
      },
      {
        id: "PRO" as const,
        name: "Pro",
        credits: toCredits(PRO_MONTHLY_ALLOTMENT_MICRO),
        resetPeriod: "monthly",
        price: {
          amount: PRO_MONTHLY_PRICE_INR,
          currency: "INR",
          period: "monthly",
        },
      },
    ],
  };
}

// ── Pay-as-you-go credit packs ────────────────────────────────────────────────

export interface CreditPack {
  id: string;
  credits: number; // display credits granted (→ bonusBalance)
  amount: number; // price in INR paise (minor units)
  currency: "INR";
}

// PAYG top-up packs. Priced ABOVE the PRO subscription's effective rate
// (₹1,499 / 5,000 credits ≈ ₹0.30/credit) to bake in the pay-as-you-go markup —
// buying à la carte costs more per credit than committing to a monthly plan,
// and the markup covers the real DeepSeek cost + payment fees. Tune freely.
export const CREDIT_PACKS: CreditPack[] = [
  { id: "pack_100", credits: 100, amount: 4900, currency: "INR" }, // ₹49  → ₹0.49/cr
  { id: "pack_500", credits: 500, amount: 19900, currency: "INR" }, // ₹199 → ₹0.40/cr
  { id: "pack_2000", credits: 2000, amount: 69900, currency: "INR" }, // ₹699 → ₹0.35/cr
];

function findPack(packId: string): CreditPack {
  const pack = CREDIT_PACKS.find((p) => p.id === packId);
  if (!pack) throw Errors.badRequest(`Unknown credit pack: ${packId}`);
  return pack;
}

export function getCreditPacks() {
  return {
    packs: CREDIT_PACKS.map((p) => ({
      id: p.id,
      credits: p.credits,
      price: { amount: p.amount, currency: p.currency },
    })),
  };
}

/**
 * Create a Razorpay one-time Order for a credit top-up. The `notes` carry the
 * userId + packId so both the client-verify callback and the webhook backstop
 * can resolve which account/pack to credit — no extra table needed.
 */
export async function createCreditOrder(userId: string, packId: string) {
  const pack = findPack(packId);
  const rzp = getRazorpay();
  await ensureBillingAccount(userId);

  const order = await rzp.orders.create({
    amount: pack.amount,
    currency: pack.currency,
    receipt: `topup_${userId.slice(0, 8)}_${Date.now()}`,
    notes: { userId, packId: pack.id, kind: "credit_topup" },
  });

  return {
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    keyId: env.RAZORPAY_KEY_ID,
    packId: pack.id,
    credits: pack.credits,
  };
}

/**
 * Verify a completed checkout from the client success callback and credit the
 * pack immediately (better UX than waiting for the webhook). Idempotent with
 * the webhook via a shared `purchase:order:{orderId}` ledger key. The order is
 * re-fetched from Razorpay so the pack/amount and owning user are authoritative
 * rather than trusted from the client.
 */
export async function verifyCreditPayment(
  userId: string,
  input: { orderId: string; paymentId: string; signature: string },
) {
  if (!env.RAZORPAY_KEY_SECRET) {
    throw Errors.badRequest("Razorpay is not configured");
  }

  const expected = crypto
    .createHmac("sha256", env.RAZORPAY_KEY_SECRET)
    .update(`${input.orderId}|${input.paymentId}`)
    .digest("hex");
  let valid = false;
  try {
    valid = crypto.timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(input.signature, "hex"),
    );
  } catch {
    valid = false;
  }
  if (!valid) throw Errors.forbidden("Invalid payment signature");

  const rzp = getRazorpay();
  const order = await rzp.orders.fetch(input.orderId);
  const notes = (order.notes ?? {}) as Record<string, string>;
  if (notes.userId !== userId) {
    throw Errors.forbidden("Order does not belong to this account");
  }
  const pack = findPack(notes.packId ?? "");

  const result = await grantBonusCredits(userId, BigInt(pack.credits) * MICRO, {
    idempotencyKey: `purchase:order:${order.id}`,
    paymentId: input.paymentId,
    reason: `credit top-up (${pack.credits})`,
  });

  return {
    creditsGranted: pack.credits,
    available: toCredits(result.available),
    availableMicro: result.available.toString(),
  };
}

// ── Subscribe ────────────────────────────────────────────────────────────────

export async function subscribeToPro(userId: string, userEmail: string) {
  if (!env.RAZORPAY_PRO_PLAN_ID) {
    throw Errors.badRequest(
      "PRO plan is not configured (RAZORPAY_PRO_PLAN_ID missing)",
    );
  }

  // Prevent duplicate active subscriptions.
  const existing = await prisma.subscription.findFirst({
    where: {
      userId,
      status: {
        in: [
          SubscriptionStatus.CREATED,
          SubscriptionStatus.AUTHENTICATED,
          SubscriptionStatus.ACTIVE,
          SubscriptionStatus.PENDING,
        ],
      },
    },
  });
  if (existing) {
    throw Errors.conflict("An active subscription already exists");
  }

  const rzp = getRazorpay();
  await ensureBillingAccount(userId);
  const account = await prisma.billingAccount.findUnique({ where: { userId } });

  // Razorpay plan prices are immutable external configuration. Fail closed if
  // the configured id still points at the old catalog price, otherwise the UI
  // could advertise ₹1,499 while checkout silently charges another amount.
  const configuredPlan = await rzp.plans.fetch(env.RAZORPAY_PRO_PLAN_ID);
  const expectedPaise = PRO_MONTHLY_PRICE_INR * 100;
  if (
    Number(configuredPlan.item.amount) !== expectedPaise ||
    configuredPlan.item.currency !== "INR" ||
    configuredPlan.period !== "monthly" ||
    configuredPlan.interval !== 1
  ) {
    throw Errors.badRequest(
      `RAZORPAY_PRO_PLAN_ID must reference the ₹${PRO_MONTHLY_PRICE_INR}/month INR plan`,
    );
  }

  // Create or reuse Razorpay customer.
  let razorpayCustomerId = account?.razorpayCustomerId ?? null;
  if (!razorpayCustomerId) {
    const customer = await rzp.customers.create({
      email: userEmail,
      name: userEmail.split("@")[0] ?? userEmail,
      fail_existing: 0,
    });
    razorpayCustomerId = customer.id;
    await prisma.billingAccount.update({
      where: { userId },
      data: { razorpayCustomerId },
    });
  }

  // Create the Razorpay subscription.
  const rzpSub = await rzp.subscriptions.create({
    plan_id: env.RAZORPAY_PRO_PLAN_ID,
    total_count: 12,
    customer_notify: 1,
  });

  // Persist our subscription record.
  await prisma.subscription.create({
    data: {
      userId,
      plan: Plan.PRO,
      status: SubscriptionStatus.CREATED,
      razorpaySubscriptionId: rzpSub.id,
      razorpayPlanId: env.RAZORPAY_PRO_PLAN_ID,
      razorpayCustomerId,
    },
  });

  return { subscriptionId: rzpSub.id, shortUrl: rzpSub.short_url };
}

// ── Get subscription ─────────────────────────────────────────────────────────

export async function getSubscription(userId: string) {
  const sub = await prisma.subscription.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  return sub;
}

// ── Cancel ───────────────────────────────────────────────────────────────────

export async function cancelSubscription(userId: string) {
  const sub = await prisma.subscription.findFirst({
    where: {
      userId,
      status: {
        in: [
          SubscriptionStatus.ACTIVE,
          SubscriptionStatus.AUTHENTICATED,
          SubscriptionStatus.PENDING,
        ],
      },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!sub) throw Errors.notFound("No active subscription found");

  const rzp = getRazorpay();
  // Cancel at end of current billing cycle (cancelAtCycleEnd = 1).
  await rzp.subscriptions.cancel(sub.razorpaySubscriptionId, 1);

  await prisma.subscription.update({
    where: { id: sub.id },
    data: { cancelAtCycleEnd: true },
  });

  return { cancelled: true };
}

// ── Webhook processing ───────────────────────────────────────────────────────

interface RazorpaySubEntity {
  id: string;
  status: string;
  current_start?: number | null;
  current_end?: number | null;
  customer_id?: string | null;
  plan_id?: string;
}

interface RazorpayOrderEntity {
  id: string;
  amount?: number;
  amount_paid?: number;
  currency?: string;
  status?: string;
  notes?: Record<string, string> | null;
}

interface RazorpayWebhookBody {
  event: string;
  payload?: {
    subscription?: { entity?: RazorpaySubEntity };
    order?: { entity?: RazorpayOrderEntity };
  };
}

function verifySignature(
  rawBody: Buffer,
  signature: string,
  secret: string,
): boolean {
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(signature, "hex"),
    );
  } catch {
    return false;
  }
}

export async function processRazorpayWebhook(
  rawBody: Buffer,
  signature: string,
  eventId: string,
) {
  if (!env.RAZORPAY_WEBHOOK_SECRET) {
    throw Errors.badRequest("Webhook secret not configured");
  }
  if (!verifySignature(rawBody, signature, env.RAZORPAY_WEBHOOK_SECRET)) {
    throw Errors.forbidden("Invalid webhook signature");
  }

  const parsed = JSON.parse(rawBody.toString("utf-8")) as RazorpayWebhookBody;
  const eventType = parsed.event;
  const subEntity = parsed.payload?.subscription?.entity;
  const orderEntity = parsed.payload?.order?.entity;

  // Idempotent upsert — if processedAt is already set this event was handled.
  const event = await prisma.webhookEvent.upsert({
    where: { id: eventId },
    create: {
      id: eventId,
      provider: "razorpay",
      type: eventType,
      payload: parsed as unknown as Prisma.InputJsonValue,
    },
    update: {},
  });
  if (event.processedAt) return;

  if (subEntity?.id) {
    await handleSubscriptionEvent(eventType, subEntity);
  }

  // Credit top-up backstop: the client-verify call usually credits first, but
  // if the user closes the tab before it returns, `order.paid` still lands it.
  // Both paths share the `purchase:order:{id}` ledger key, so this never
  // double-credits.
  if (eventType === "order.paid" && orderEntity?.id) {
    await handleCreditOrderPaid(orderEntity);
  }

  await prisma.webhookEvent.update({
    where: { id: eventId },
    data: { processedAt: new Date() },
  });
}

async function handleSubscriptionEvent(
  eventType: string,
  sub: RazorpaySubEntity,
) {
  const record = await prisma.subscription.findUnique({
    where: { razorpaySubscriptionId: sub.id },
  });
  if (!record) {
    console.warn(
      `[webhook] unknown Razorpay subscription ${sub.id} for event ${eventType}`,
    );
    return;
  }

  switch (eventType) {
    case "subscription.activated":
      await handleActivated(record.id, record.userId);
      break;

    case "subscription.charged":
      await handleCharged(
        record.id,
        record.userId,
        record.razorpaySubscriptionId,
        sub,
      );
      break;

    case "subscription.pending":
      await updateSubStatus(record.id, SubscriptionStatus.PENDING);
      break;

    case "subscription.halted":
      await updateSubStatus(record.id, SubscriptionStatus.HALTED);
      break;

    case "subscription.cancelled":
      await handleTerminal(
        record.id,
        record.userId,
        SubscriptionStatus.CANCELLED,
      );
      break;

    case "subscription.completed":
      await handleTerminal(
        record.id,
        record.userId,
        SubscriptionStatus.COMPLETED,
      );
      break;

    case "subscription.expired":
      await handleTerminal(
        record.id,
        record.userId,
        SubscriptionStatus.EXPIRED,
      );
      break;
  }
}

async function handleCreditOrderPaid(order: RazorpayOrderEntity) {
  const notes = order.notes ?? {};
  if (notes.kind !== "credit_topup" || !notes.userId || !notes.packId) return;

  const pack = CREDIT_PACKS.find((p) => p.id === notes.packId);
  if (!pack) {
    console.warn(
      `[webhook] unknown credit pack ${notes.packId} for order ${order.id}`,
    );
    return;
  }

  await grantBonusCredits(notes.userId, BigInt(pack.credits) * MICRO, {
    idempotencyKey: `purchase:order:${order.id}`,
    reason: `credit top-up (${pack.credits})`,
  });
}

async function handleActivated(subscriptionDbId: string, userId: string) {
  await prisma.$transaction([
    prisma.subscription.update({
      where: { id: subscriptionDbId },
      data: { status: SubscriptionStatus.ACTIVE },
    }),
    prisma.billingAccount.update({
      where: { userId },
      data: { plan: Plan.PRO },
    }),
  ]);
  await syncUser(userId);
}

async function handleCharged(
  subscriptionDbId: string,
  userId: string,
  razorpaySubscriptionId: string,
  sub: RazorpaySubEntity,
) {
  const cycleStart = sub.current_start
    ? new Date(sub.current_start * 1000)
    : new Date();
  const cycleEnd = sub.current_end
    ? new Date(sub.current_end * 1000)
    : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  await prisma.subscription.update({
    where: { id: subscriptionDbId },
    data: {
      status: SubscriptionStatus.ACTIVE,
      currentStart: cycleStart,
      currentEnd: cycleEnd,
    },
  });

  // Expire prior unused plan credits + grant new cycle.
  await grantPlanCycle(userId, razorpaySubscriptionId, cycleStart, cycleEnd);
}

async function updateSubStatus(
  subscriptionDbId: string,
  status: SubscriptionStatus,
) {
  await prisma.subscription.update({
    where: { id: subscriptionDbId },
    data: { status },
  });
}

async function handleTerminal(
  subscriptionDbId: string,
  userId: string,
  status: SubscriptionStatus,
) {
  await prisma.$transaction([
    prisma.subscription.update({
      where: { id: subscriptionDbId },
      data: { status },
    }),
    prisma.billingAccount.update({
      where: { userId },
      data: { plan: Plan.FREE },
    }),
  ]);
  await syncUser(userId);
}
