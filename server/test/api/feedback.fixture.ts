import { beforeEach, describe, expect, mock, test } from "bun:test";

let feedback: { id: string; userId: string }[] = [];
let claimed = 0;
let ownedProject = true;
let bonus = 0n;
let redeemed = false;
let creditsGranted = 100_000_000n;
const ledger: { amount: bigint; reason: string }[] = [];
let claimWhere: unknown;
const tx = {
  project: { findFirst: async () => ownedProject ? { id: "project" } : null },
  feedback: {
    create: async ({ data }: { data: { userId: string } }) => { const row = { ...data, id: "feedback" }; feedback.push(row); return row; },
    findFirst: async ({ where }: { where: { userId: string } }) => feedback.find((f) => f.userId === where.userId) ?? null,
  },
  attachment: { updateMany: async ({ where }: { where: unknown }) => { claimWhere = where; return { count: claimed }; } },
  $executeRaw: async () => 1,
  promoCode: {
    findUnique: async () => ({ id: "promo", credits: creditsGranted, isActive: true, expiresAt: null, maxRedemptions: null }),
    update: async () => ({}),
  },
  promoRedemption: {
    create: async () => { if (redeemed) throw { code: "P2002" }; redeemed = true; return { id: "redemption" }; },
    findFirst: async () => redeemed ? { id: "redemption" } : null,
  },
  billingAccount: {
    upsert: async () => ({}),
    findUnique: async () => ({ freeBalance: 300_000_000n, planBalance: 0n, bonusBalance: bonus }),
    update: async ({ data }: { data: { bonusBalance: bigint } }) => { bonus = data.bonusBalance; return {}; },
  },
  creditLedger: {
    findUnique: async () => ({ id: "signup-grant" }),
    create: async ({ data }: { data: { amount: bigint; reason: string } }) => { ledger.push(data); return data; },
  },
};
mock.module("@/lib/prisma", () => ({ prisma: {
  ...tx,
  $transaction: async (run: (client: typeof tx) => Promise<unknown>) => {
    const snapshot = [...feedback];
    try { return await run(tx); } catch (error) { feedback = snapshot; throw error; }
  },
} }));
mock.module("@/lib/s3", () => ({ presignGet: async () => "https://files.example/attachment" }));
mock.module("@/lib/log", () => ({ createLogger: () => ({ info: () => {} }), log: { info: () => {} } }));

const { feedbackSchema } = await import("@/api/schemas/feedback.schema");
const { submitFeedback } = await import("@/api/services/feedback.service");
const { redeem, PromoCodeInvalidError, PromoCodeAlreadyRedeemedError } = await import("@/lib/credits");
const id = "550e8400-e29b-41d4-a716-446655440000";

beforeEach(() => { feedback = []; claimed = 0; ownedProject = true; bonus = 0n; redeemed = false; creditsGranted = 100_000_000n; ledger.length = 0; claimWhere = undefined; });

describe("feedback validation", () => {
  test("requires an integer star rating, even for suggestions", () => {
    for (const rating of [undefined, 0, 6, 2.5, "5"]) expect(feedbackSchema.safeParse({ rating, kind: "suggestion" }).success).toBe(false);
  });
  test("accepts every rating without requiring text or files", () => {
    for (let rating = 1; rating <= 5; rating++) expect(feedbackSchema.parse({ rating }).attachmentIds).toEqual([]);
  });
  test("rejects oversized messages, duplicate files, invalid IDs and more than five files", () => {
    expect(feedbackSchema.safeParse({ rating: 5, message: "x".repeat(5001) }).success).toBe(false);
    expect(feedbackSchema.safeParse({ rating: 5, attachmentIds: [id, id] }).success).toBe(false);
    expect(feedbackSchema.safeParse({ rating: 5, attachmentIds: ["other-user"] }).success).toBe(false);
    expect(feedbackSchema.safeParse({ rating: 5, attachmentIds: Array(6).fill(id) }).success).toBe(false);
  });
});

describe("feedback and EXTRA100", () => {
  test("saves star-only feedback and unlocks the code without immediately granting credits", async () => {
    const result = await submitFeedback("user", feedbackSchema.parse({ rating: 1 }));
    expect(feedback).toHaveLength(1);
    expect(result).toMatchObject({ promoCode: "EXTRA100", credits: 100, alreadyRedeemed: false });
    expect(bonus).toBe(0n);
  });
  test("rejects a project owned by another user", async () => {
    ownedProject = false;
    await expect(submitFeedback("user", feedbackSchema.parse({ rating: 5, projectId: id }))).rejects.toThrow("Project not found");
    expect(feedback).toHaveLength(0);
  });
  test("rejects incomplete, reused or foreign attachments and rolls back feedback", async () => {
    await expect(submitFeedback("user", feedbackSchema.parse({ rating: 4, attachmentIds: [id] }))).rejects.toThrow("Some files");
    expect(feedback).toHaveLength(0);
    expect(claimWhere).toMatchObject({ userId: "user", messageId: null, feedbackId: null, status: { in: ["READY", "FAILED"] }, blobKey: { not: null } });
  });
  test("claims optional uploaded files and saves suggestions", async () => {
    claimed = 1;
    await submitFeedback("user", feedbackSchema.parse({ rating: 3, kind: "suggestion", attachmentIds: [id], message: " Add keyboard shortcuts " }));
    expect(feedback[0]).toMatchObject({ kind: "suggestion", message: "Add keyboard shortcuts" });
  });
  test("knowing the code does not allow redemption without your own feedback", async () => {
    feedback.push({ id: "other", userId: "other-user" });
    await expect(redeem("user", "extra100")).rejects.toBeInstanceOf(PromoCodeInvalidError);
    expect(bonus).toBe(0n); expect(ledger).toHaveLength(0);
  });
  test("redeems exactly 100 bonus credits with a ledger entry and rejects a second redemption", async () => {
    await submitFeedback("user", feedbackSchema.parse({ rating: 1 }));
    const result = await redeem("user", " extra100 ");
    expect(result).toEqual({ creditsGranted: 100_000_000n, available: 400_000_000n });
    expect(ledger[0]).toMatchObject({ amount: 100_000_000n, reason: "promo EXTRA100" });
    await expect(redeem("user", "EXTRA100")).rejects.toBeInstanceOf(PromoCodeAlreadyRedeemedError);
    expect(bonus).toBe(100_000_000n); expect(ledger).toHaveLength(1);
    const next = await submitFeedback("user", feedbackSchema.parse({ rating: 4 }));
    expect(next.alreadyRedeemed).toBe(true);
  });
  test("other promo codes still redeem without feedback", async () => {
    creditsGranted = 25_000_000n;
    expect((await redeem("user", "WELCOME" )).creditsGranted).toBe(25_000_000n);
  });
});
