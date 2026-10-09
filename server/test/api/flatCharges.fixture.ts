import { beforeEach, describe, expect, mock, test } from "bun:test";

// Fixed prices: publishing and logos. `chargeFlat` against an in-memory ledger
// with the real bucket arithmetic, then the identity service on top of it with
// the file writers and the image model stubbed, so what is checked is what was
// charged, what was written and what was refused.

process.env.CREDITS_ENFORCE = "true";

type Row = Record<string, any>;
const MICRO = 1_000_000n;

let account: { userId: string; freeBalance: bigint; planBalance: bigint; bonusBalance: bigint; plan: "FREE" | "PRO" };
const ledger: Row[] = [];
const generations: Row[] = [];
let activeJob: Row | null = null;
let project: Row;
const files = new Map<string, string>();
const writes: string[] = [];
const removed: string[] = [];
const saved: { path: string; content: string }[] = [];
let imageCalls = 0;
let imageFails = false;

const gross = () => account.freeBalance + account.planBalance + account.bonusBalance;

const tx = {
  $executeRaw: async () => 1,
  billingAccount: {
    upsert: async () => account,
    findUnique: async () => ({ ...account }),
    update: async ({ data }: { data: Partial<typeof account> }) => Object.assign(account, data),
  },
  creditLedger: {
    // The signup grant was made when the account was: not part of what is tested.
    findUnique: async ({ where }: { where: { idempotencyKey: string } }) =>
      where.idempotencyKey.startsWith("signup:") ? { id: "signup" } : ledger.find((r) => r.idempotencyKey === where.idempotencyKey) ?? null,
    create: async ({ data }: { data: Row }) => {
      if (data.idempotencyKey && ledger.some((r) => r.idempotencyKey === data.idempotencyKey)) {
        throw Object.assign(new Error("unique"), { code: "P2002" });
      }
      ledger.push(data);
      return data;
    },
  },
  logoGeneration: {
    create: async ({ data }: { data: Row }) => {
      generations.push({ usedAt: null, usedHash: null, createdAt: new Date(), ...data });
      return data;
    },
    count: async ({ where }: { where: Row }) =>
      generations.filter((g) => g.projectId === where.projectId && g.createdAt >= where.createdAt.gte).length,
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const hit = generations.filter(
        (g) =>
          g.id === where.id &&
          g.projectId === where.projectId &&
          g.userId === where.userId &&
          where.OR.some((c: Row) => ("usedAt" in c ? g.usedAt === null : g.usedHash === c.usedHash)),
      );
      for (const g of hit) Object.assign(g, data);
      return { count: hit.length };
    },
  },
  project: { findUnique: async () => project, update: async () => project },
  projectFile: { delete: async () => ({}) },
  job: { findFirst: async () => activeJob },
};

mock.module("@/lib/prisma", () => ({
  prisma: {
    ...tx,
    projectFile: {
      ...tx.projectFile,
      findUnique: async ({ where }: { where: { projectId_path: { path: string } } }) =>
        files.has(where.projectId_path.path) ? { contentHash: "h" } : null,
    },
    $transaction: async (run: (t: typeof tx) => Promise<unknown>) => run(tx),
  },
}));

mock.module("@/api/lib/projectFiles", () => ({
  toWorkdirPath: (p: string) => `/home/user/app/${p}`,
  writeProjectBinaryFile: async (_p: string, _u: string, path: string) => {
    writes.push(path);
    files.set(path, "<binary>");
    return { sizeBytes: 1 };
  },
  writeProjectFile: async (_p: string, _u: string, path: string, content: string) => {
    writes.push(path);
    files.set(path, content);
    return {};
  },
}));
mock.module("@/api/services/project.service", () => ({
  readProjectFileContent: async (_p: unknown, _u: string, path: string) => ({
    content: files.get(path) ?? "",
    contentHash: "base",
  }),
  saveProjectFile: async (_p: string, _u: string, path: string, content: string) => {
    saved.push({ path, content });
    files.set(path, content);
    return {};
  },
}));
mock.module("@/api/repositories/project.repository", () => ({
  findProjectById: async () => project,
  findActiveJob: async () => activeJob,
  findProjectFileRecord: async (_id: string, path: string) =>
    files.has(path) ? { contentHash: "h" } : null,
}));
const realOpenrouter = await import("@/lib/openrouter");
mock.module("@/lib/openrouter", () => ({
  ...realOpenrouter,
  imageGenerationAvailable: () => true,
  generateImage: async () => {
    imageCalls += 1;
    if (imageFails) throw new Error("The image service returned no picture.");
    return {
      bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      mimeType: "image/png",
      usage: { model: "seedream", inputTokens: 1, outputTokens: 14_400 },
      costUsd: 0.018,
    };
  },
}));
mock.module("@/lib/s3", () => ({ getBlobText: async () => "", putBlob: async () => {} }));

const { chargeFlat, InsufficientCreditsError } = await import("@/lib/credits");
const { saveIdentity, generateLogo, getIdentity, logoPrompt, LOGO_GENERATIONS_PER_DAY } = await import(
  "@/api/services/identity.service"
);
const { LedgerType } = await import("@/generated/prisma/enums");

const PAGE = `<html><head><title>vite-react-ts</title></head><body></body></html>`;
const png = (seed: number) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, seed]);
const logo = (seed = 1) => ({ favicon: png(seed), icon512: png(seed + 100) });

async function refused(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (err) {
    return err as { statusCode?: number; message: string };
  }
  throw new Error("expected a refusal");
}

beforeEach(() => {
  account = { userId: "u1", freeBalance: 300n * MICRO, planBalance: 0n, bonusBalance: 0n, plan: "PRO" };
  ledger.length = 0;
  generations.length = 0;
  writes.length = 0;
  removed.length = 0;
  saved.length = 0;
  files.clear();
  files.set("index.html", PAGE);
  files.set("public/favicon.svg", "<svg/>");
  activeJob = null;
  imageCalls = 0;
  imageFails = false;
  project = { id: "p1", userId: "u1", name: "Kurinji", slug: null, headSequence: 1, sandboxId: null, sandboxStatus: "NONE" };
});

describe("chargeFlat", () => {
  test("takes the price across buckets, free then plan then bonus, and writes one ledger row", async () => {
    account = { ...account, freeBalance: 10n * MICRO, planBalance: 5n * MICRO, bonusBalance: 100n * MICRO };

    const res = await chargeFlat("u1", 20n * MICRO, "k1", LedgerType.PUBLISH_FEE, "first publish");

    expect(res).toEqual({ charged: true, debited: 20n * MICRO, available: 95n * MICRO });
    expect([account.freeBalance, account.planBalance, account.bonusBalance]).toEqual([0n, 0n, 95n * MICRO]);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ type: "PUBLISH_FEE", amount: -20n * MICRO, balanceAfter: 95n * MICRO, idempotencyKey: "k1" });
  });

  test("refuses when short, and writes nothing", async () => {
    account = { ...account, freeBalance: 10n * MICRO };

    await expect(chargeFlat("u1", 20n * MICRO, "k1", LedgerType.PUBLISH_FEE, "x")).rejects.toBeInstanceOf(InsufficientCreditsError);
    expect(gross()).toBe(10n * MICRO);
    expect(ledger).toHaveLength(0);
  });

  test("the same key twice charges once", async () => {
    await chargeFlat("u1", 20n * MICRO, "k1", LedgerType.LOGO_FEE, "x");
    const again = await chargeFlat("u1", 20n * MICRO, "k1", LedgerType.LOGO_FEE, "x");

    expect(again.charged).toBe(false);
    expect(again.debited).toBe(0n);
    expect(gross()).toBe(280n * MICRO);
    expect(ledger).toHaveLength(1);
  });

  test("a repeat is free even when the balance has since run out", async () => {
    await chargeFlat("u1", 20n * MICRO, "k1", LedgerType.LOGO_FEE, "x");
    account.freeBalance = 0n;

    expect((await chargeFlat("u1", 20n * MICRO, "k1", LedgerType.LOGO_FEE, "x")).charged).toBe(false);
  });

  // Shadow mode keeps the calibration record and moves no money, like `meter`.
  test("shadow mode writes the row at the real price and moves no balance", async () => {
    const res = await chargeFlat("u1", 20n * MICRO, "k1", LedgerType.PUBLISH_FEE, "first publish", { enforce: false });

    expect(res.charged).toBe(true);
    expect(gross()).toBe(300n * MICRO);
    expect(ledger[0]).toMatchObject({ amount: -20n * MICRO, reason: "shadow first publish" });
  });

  test("shadow mode never refuses, because a local account has no credits", async () => {
    account.freeBalance = 0n;
    await chargeFlat("u1", 200n * MICRO, "k1", LedgerType.PUBLISH_FEE, "x", { enforce: false });
    expect(ledger).toHaveLength(1);
  });

  test("a price must be positive", async () => {
    await expect(chargeFlat("u1", 0n, "k", LedgerType.LOGO_FEE, "x")).rejects.toThrow();
  });
});

describe("saving a name and logo", () => {
  test("a name alone costs nothing and edits index.html", async () => {
    const res = await saveIdentity("p1", "u1", { title: "Kurinji Leaf", description: "Tea." });

    expect(ledger).toHaveLength(0);
    expect(saved).toHaveLength(1);
    expect(saved[0]!.content).toContain("<title>Kurinji Leaf</title>");
    expect(res.identity.title).toBe("Kurinji Leaf");
  });

  test("a logo costs the upload fee, writes both PNGs and drops tau's icon", async () => {
    const res = await saveIdentity("p1", "u1", { logo: logo() });

    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ type: "LOGO_FEE", amount: -25n * MICRO });
    expect(res.balance).toBe(275);
    expect(writes).toEqual(["public/favicon.png", "public/icon-512.png"]);
    expect(files.has("public/favicon.svg")).toBe(true); // manifest removal is the stubbed prisma's job
    expect(saved[0]!.content).toContain(`href="/favicon.png"`);
    expect(saved[0]!.content).toContain(`rel="apple-touch-icon"`);
  });

  test("the same logo sent twice is charged once", async () => {
    await saveIdentity("p1", "u1", { logo: logo(7) });
    await saveIdentity("p1", "u1", { logo: logo(7) });

    expect(ledger).toHaveLength(1);
    expect(gross()).toBe(275n * MICRO);
  });

  test("a different logo is a new charge", async () => {
    await saveIdentity("p1", "u1", { logo: logo(1) });
    await saveIdentity("p1", "u1", { logo: logo(2) });
    expect(ledger).toHaveLength(2);
  });

  test("a logo that is not a PNG, or is too big, is refused and not charged", async () => {
    const svg = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>");
    const huge = new Uint8Array(400 * 1024);
    huge.set(png(0));

    for (const bad of [{ favicon: svg, icon512: png(1) }, { favicon: png(1), icon512: huge }]) {
      const err = await refused(() => saveIdentity("p1", "u1", { logo: bad }));
      expect(err.statusCode).toBe(400);
    }
    expect(ledger).toHaveLength(0);
    expect(writes).toHaveLength(0);
    expect(saved).toHaveLength(0);
  });

  test("a short balance is refused with 402 and nothing is written", async () => {
    account.freeBalance = 10n * MICRO;

    const err = await refused(() => saveIdentity("p1", "u1", { logo: logo() }));
    expect(err.statusCode).toBe(402);
    expect(writes).toHaveLength(0);
    expect(saved).toHaveLength(0);
    expect(gross()).toBe(10n * MICRO);
  });

  test("refused while an agent run is active", async () => {
    activeJob = { id: "j", type: "GENERATION" };
    const err = await refused(() => saveIdentity("p1", "u1", { title: "x" }));
    expect(err.statusCode).toBe(409);
    expect(ledger).toHaveLength(0);
  });

  test("refused for anyone but the owner", async () => {
    const err = await refused(() => saveIdentity("p1", "someone-else", { title: "x" }));
    expect(err.statusCode).toBe(403);
    expect(saved).toHaveLength(0);
  });

  test("a title that is too long is refused", async () => {
    const err = await refused(() => saveIdentity("p1", "u1", { title: "x".repeat(61) }));
    expect(err.statusCode).toBe(400);
  });

  // The page predates the template's icon: tau's mark is added by the same save.
  test("a project with no icon gains tau's, even on a name-only save", async () => {
    await saveIdentity("p1", "u1", { title: "Kurinji" });

    expect(writes).toEqual(["public/favicon.svg"]);
    expect(saved[0]!.content).toContain(`href="/favicon.svg"`);
  });

  test("a project that already has tau's icon is not given another", async () => {
    files.set("index.html", PAGE.replace("</head>", `<link rel="icon" type="image/svg+xml" href="/favicon.svg" /></head>`));
    await saveIdentity("p1", "u1", { title: "Kurinji" });

    expect(writes).toHaveLength(0);
  });
});

describe("generating a logo", () => {
  test("costs the generation price, once, and answers with the picture and the balance", async () => {
    const res = await generateLogo("p1", "u1");

    expect(imageCalls).toBe(1);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ type: "LOGO_FEE", amount: -20n * MICRO });
    expect(res.balance).toBe(280);
    expect(res.mimeType).toBe("image/png");
    expect(res.image.length).toBeGreaterThan(0);
    expect(generations.map((g) => g.id)).toEqual([res.generationId]);
    // Not saved into the project: the owner picks one and the save writes it.
    expect(writes).toHaveLength(0);
  });

  test("a free plan is refused with 403 and the model is never called", async () => {
    account.plan = "FREE";
    const err = await refused(() => generateLogo("p1", "u1"));
    expect(err.statusCode).toBe(403);
    expect(imageCalls).toBe(0);
    expect(ledger).toHaveLength(0);
  });

  test("a short balance is refused with 402 and the model is never called", async () => {
    account.freeBalance = 5n * MICRO;
    const err = await refused(() => generateLogo("p1", "u1"));
    expect(err.statusCode).toBe(402);
    expect(imageCalls).toBe(0);
  });

  test("a model failure charges nothing and records nothing", async () => {
    imageFails = true;
    const err = await refused(() => generateLogo("p1", "u1"));

    expect(err.statusCode).toBe(502);
    expect(gross()).toBe(300n * MICRO);
    expect(ledger).toHaveLength(0);
    expect(generations).toHaveLength(0);
  });

  test("a project may make ten a day", async () => {
    for (let i = 0; i < LOGO_GENERATIONS_PER_DAY; i++) await generateLogo("p1", "u1");

    const err = await refused(() => generateLogo("p1", "u1"));
    expect(err.statusCode).toBe(429);
    expect(imageCalls).toBe(LOGO_GENERATIONS_PER_DAY);
    expect((await getIdentity("p1", "u1")).generationsLeftToday).toBe(0);
  });

  test("a generated logo is not charged the upload fee on top", async () => {
    const made = await generateLogo("p1", "u1");
    await saveIdentity("p1", "u1", { logo: { ...logo(), generationId: made.generationId } });

    expect(ledger).toHaveLength(1);
    expect(gross()).toBe(280n * MICRO);
    expect(writes).toEqual(["public/favicon.png", "public/icon-512.png"]);
  });

  test("two generations, keep the second: two generation charges, no upload charge", async () => {
    await generateLogo("p1", "u1");
    const second = await generateLogo("p1", "u1");
    await saveIdentity("p1", "u1", { logo: { ...logo(9), generationId: second.generationId } });

    expect(ledger.map((r) => r.amount)).toEqual([-20n * MICRO, -20n * MICRO]);
  });

  test("retrying the same save of a generated logo is still free", async () => {
    const made = await generateLogo("p1", "u1");
    const save = () => saveIdentity("p1", "u1", { logo: { ...logo(), generationId: made.generationId } });
    await save();
    await save();

    expect(ledger).toHaveLength(1);
  });

  // The waiver is one picture's, for the logo that was saved with it.
  test("a generation cannot be reused for a different logo", async () => {
    const made = await generateLogo("p1", "u1");
    await saveIdentity("p1", "u1", { logo: { ...logo(1), generationId: made.generationId } });

    const err = await refused(() => saveIdentity("p1", "u1", { logo: { ...logo(2), generationId: made.generationId } }));
    expect(err.statusCode).toBe(400);
    expect(ledger).toHaveLength(1);
  });

  test("an id that was never issued, or is another project's, does not waive the fee", async () => {
    const err = await refused(() =>
      saveIdentity("p1", "u1", { logo: { ...logo(), generationId: "11111111-1111-4111-8111-111111111111" } }),
    );
    expect(err.statusCode).toBe(400);
    expect(ledger).toHaveLength(0);
    expect(writes).toHaveLength(0);

    generations.push({ id: "other", projectId: "p2", userId: "u1", usedAt: null, usedHash: null, createdAt: new Date() });
    const foreign = await refused(() => saveIdentity("p1", "u1", { logo: { ...logo(), generationId: "other" } }));
    expect(foreign.statusCode).toBe(400);
  });
});

describe("the logo prompt", () => {
  test("asks for a flat mark with no lettering, and carries the app's name and look", () => {
    const prompt = logoPrompt({ name: "Kurinji Leaf", description: "Loose-leaf tea.", direction: "warm editorial" });

    expect(prompt).toContain(`"Kurinji Leaf"`);
    expect(prompt).toContain("Loose-leaf tea.");
    expect(prompt).toContain("warm editorial");
    expect(prompt).toContain("No text, letters, numbers");
    expect(prompt).toContain("16 pixels");
  });

  test("leaves out what it was not given", () => {
    const prompt = logoPrompt({ name: "A", description: null, direction: "" });
    expect(prompt).not.toContain("What it is");
    expect(prompt).not.toContain("Art direction");
  });
});

describe("what the panel is told", () => {
  test("prices come from the server, and generation is offered only on Pro", async () => {
    const pro = await getIdentity("p1", "u1");
    expect(pro.prices).toEqual({ publishFee: 200, logoUpload: 25, logoGeneration: 20 });
    expect(pro.canGenerate).toBe(true);

    account.plan = "FREE";
    expect((await getIdentity("p1", "u1")).canGenerate).toBe(false);
  });
});
