import crypto from "node:crypto";
import { prisma } from "../lib/prisma";
import { env } from "../lib/env";
import { Errors } from "../lib/errors";
import { getRazorpay } from "../lib/razorpay";
import { grantPlanCycle, ensureBillingAccount } from "../lib/credits";
import { PRO_MONTHLY_ALLOTMENT_MICRO, toCredits } from "../lib/pricing";
import type { Prisma } from "../generated/prisma/client";
import { Plan, SubscriptionStatus } from "../generated/prisma/enums";

// ── Static plan catalog ──────────────────────────────────────────────────────

export function getPlans() {
  return {
    plans: [
      {
        id: "FREE" as const,
        name: "Free",
        credits: toCredits(50n * 1_000_000n),
        resetPeriod: "daily",
        price: null,
      },
      {
        id: "PRO" as const,
        name: "Pro",
        credits: toCredits(PRO_MONTHLY_ALLOTMENT_MICRO),
        resetPeriod: "monthly",
        price: { amount: 999, currency: "INR", period: "monthly" },
      },
    ],
  };
}

// ── Subscribe ────────────────────────────────────────────────────────────────

export async function subscribeToPro(userId: string, userEmail: string) {
  if (!env.RAZORPAY_PRO_PLAN_ID) {
    throw Errors.badRequest("PRO plan is not configured (RAZORPAY_PRO_PLAN_ID missing)");
  }

  // Prevent duplicate active subscriptions.
  const existing = await prisma.subscription.findFirst({
    where: {
      userId,
      status: { in: [SubscriptionStatus.CREATED, SubscriptionStatus.AUTHENTICATED, SubscriptionStatus.ACTIVE, SubscriptionStatus.PENDING] },
    },
  });
  if (existing) {
    throw Errors.conflict("An active subscription already exists");
  }

  const rzp = getRazorpay();
  await ensureBillingAccount(userId);
  const account = await prisma.billingAccount.findUnique({ where: { userId } });

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
      status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.AUTHENTICATED, SubscriptionStatus.PENDING] },
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

interface RazorpayWebhookBody {
  event: string;
  payload?: { subscription?: { entity?: RazorpaySubEntity } };
}

function verifySignature(rawBody: Buffer, signature: string, secret: string): boolean {
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
    console.warn(`[webhook] unknown Razorpay subscription ${sub.id} for event ${eventType}`);
    return;
  }

  switch (eventType) {
    case "subscription.activated":
      await handleActivated(record.id, record.userId);
      break;

    case "subscription.charged":
      await handleCharged(record.id, record.userId, record.razorpaySubscriptionId, sub);
      break;

    case "subscription.pending":
      await updateSubStatus(record.id, SubscriptionStatus.PENDING);
      break;

    case "subscription.halted":
      await updateSubStatus(record.id, SubscriptionStatus.HALTED);
      break;

    case "subscription.cancelled":
      await handleTerminal(record.id, record.userId, SubscriptionStatus.CANCELLED);
      break;

    case "subscription.completed":
      await handleTerminal(record.id, record.userId, SubscriptionStatus.COMPLETED);
      break;

    case "subscription.expired":
      await handleTerminal(record.id, record.userId, SubscriptionStatus.EXPIRED);
      break;
  }
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

async function updateSubStatus(subscriptionDbId: string, status: SubscriptionStatus) {
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
}
