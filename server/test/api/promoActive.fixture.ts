import { beforeEach, describe, expect, mock, test } from "bun:test";

// Switching a promo code off from the ops console. It must be an update, never
// a delete: deleting would cascade away the redemption history and with it the
// once-per-user guard. The returned row must say "inactive" straight away so
// the table reflects it without a reload.

type Row = {
  id: string;
  code: string;
  credits: bigint;
  description: string | null;
  redeemedCount: number;
  maxRedemptions: number | null;
  perUserLimit: number;
  expiresAt: Date | null;
  isActive: boolean;
  createdAt: Date;
};

let rows: Row[] = [];
const calls: string[] = [];

mock.module("@/lib/prisma", () => ({
  prisma: {
    promoCode: {
      findUnique: async ({ where }: { where: { id: string } }) => rows.find((r) => r.id === where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: { isActive: boolean } }) => {
        calls.push(`update:${where.id}:${data.isActive}`);
        const row = rows.find((r) => r.id === where.id)!;
        row.isActive = data.isActive;
        return { ...row };
      },
      delete: async () => {
        calls.push("delete");
        return {};
      },
    },
  },
}));

const { setPromoCodeActive } = await import("@/api/services/credits.service");

beforeEach(() => {
  calls.length = 0;
  rows = [
    {
      id: "p1",
      code: "LAUNCH50",
      credits: 50_000_000n,
      description: null,
      redeemedCount: 412,
      maxRedemptions: null,
      perUserLimit: 1,
      expiresAt: null,
      isActive: true,
      createdAt: new Date(),
    },
  ];
});

describe("setPromoCodeActive", () => {
  test("deactivating updates the flag, never deletes, and reports inactive", async () => {
    const row = await setPromoCodeActive("p1", false);
    expect(calls).toEqual(["update:p1:false"]);
    expect(row.status).toBe("inactive");
    expect(row.redeemedCount).toBe(412);
    expect(row.credits).toBe(50);
  });

  test("reactivating flips it back", async () => {
    rows[0]!.isActive = false;
    const row = await setPromoCodeActive("p1", true);
    expect(calls).toEqual(["update:p1:true"]);
    expect(row.status).toBe("active");
    expect(row.expired).toBe(false);
    expect(row.usedUp).toBe(false);
  });

  test("reports what else would still block a reactivated code", async () => {
    rows[0]!.isActive = false;
    rows[0]!.expiresAt = new Date(Date.now() - 1000);
    rows[0]!.maxRedemptions = 412;
    const row = await setPromoCodeActive("p1", true);
    expect(row.status).toBe("expired");
    expect(row.expired).toBe(true);
    expect(row.usedUp).toBe(true);
  });

  test("404s for an unknown id and changes nothing", async () => {
    let status: number | undefined;
    await setPromoCodeActive("nope", false).catch((e: { statusCode?: number }) => {
      status = e.statusCode;
    });
    expect(status).toBe(404);
    expect(calls).toEqual([]);
  });
});
