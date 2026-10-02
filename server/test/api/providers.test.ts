import { describe, expect, test } from "bun:test";

// providers.ts reads its keys from env at call time; the parsers under test
// never touch the network.
const { parseDeepseekBalance, parseKimiBalance, parseTavilyUsage } = await import(
  "@/api/lib/providers"
);

describe("DeepSeek /user/balance", () => {
  test("parses decimal strings per currency", () => {
    expect(
      parseDeepseekBalance({
        is_available: true,
        balance_infos: [
          { currency: "CNY", total_balance: "110.00", granted_balance: "10.00", topped_up_balance: "100.00" },
        ],
      }),
    ).toEqual({
      available: true,
      balances: [{ currency: "CNY", total: 110, granted: 10, toppedUp: 100 }],
    });
  });

  test("an unparseable amount reads as zero rather than failing the check", () => {
    const b = parseDeepseekBalance({
      is_available: false,
      balance_infos: [{ currency: "USD", total_balance: "n/a" }],
    });
    expect(b.balances[0]).toEqual({ currency: "USD", total: 0, granted: 0, toppedUp: 0 });
  });

  test("rejects a payload that isn't a balance", () => {
    expect(() => parseDeepseekBalance({ error: "unauthorized" })).toThrow();
  });
});

describe("Moonshot /users/me/balance", () => {
  test("reads the data envelope", () => {
    expect(
      parseKimiBalance(
        {
          code: 0,
          data: { available_balance: 49.58894, voucher_balance: 46.58893, cash_balance: 3.00001 },
          scode: "0x0",
          status: true,
        },
        "USD",
      ),
    ).toEqual({ currency: "USD", available: 49.58894, voucher: 46.58893, cash: 3.00001 });
  });
});

describe("Tavily /usage", () => {
  test("maps plan and key usage", () => {
    expect(
      parseTavilyUsage({
        key: { usage: 150, limit: 1000, search_usage: 100 },
        account: { current_plan: "Bootstrap", plan_usage: 500, plan_limit: 15000, paygo_usage: 25, paygo_limit: 100 },
      }),
    ).toEqual({
      plan: "Bootstrap",
      planUsage: 500,
      planLimit: 15000,
      paygoUsage: 25,
      paygoLimit: 100,
      keyUsage: 150,
      keyLimit: 1000,
    });
  });

  test("missing sections become nulls", () => {
    expect(parseTavilyUsage({})).toEqual({
      plan: null,
      planUsage: null,
      planLimit: null,
      paygoUsage: null,
      paygoLimit: null,
      keyUsage: null,
      keyLimit: null,
    });
  });
});
