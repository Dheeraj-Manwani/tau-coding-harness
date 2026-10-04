import { expect, test } from "bun:test";

// Uses connection-local temporary tables, so no real projects are read or changed.
test.skipIf(process.env.RUN_DB_TESTS !== "1")("showcase selects only eligible live deployments and ranks build turns", async () => {
  const { prisma } = await import("../../src/lib/prisma");
  const { findShowcaseSites } = await import("../../src/api/repositories/showcase.repository");
  const now = new Date("2026-10-05T00:00:00Z");
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`CREATE TEMP TABLE "Project" ("id" text, "slug" text, "userId" text, "liveDeploymentId" text) ON COMMIT DROP`;
    await tx.$executeRaw`CREATE TEMP TABLE "Deployment" ("id" text, "projectId" text, "status" text, "purgedAt" timestamptz, "error" text, "fileCount" int, "completedAt" timestamptz) ON COMMIT DROP`;
    await tx.$executeRaw`CREATE TEMP TABLE "Message" ("projectId" text, "role" text, "type" text) ON COMMIT DROP`;
    async function seed(id: string, options: { owner?: string; turns?: number; status?: string; purged?: boolean; error?: string; count?: number; age?: number; live?: boolean; messageType?: string } = {}) {
      const live = options.live === false ? null : id;
      const completed = new Date(now.getTime() - (options.age ?? 1) * 86_400_000);
      const purged = options.purged ? now : null;
      await tx.$executeRaw`INSERT INTO "Project" VALUES (${id}, ${id}, ${options.owner ?? "other"}, ${live})`;
      await tx.$executeRaw`INSERT INTO "Deployment" VALUES (${id}, ${id}, ${options.status ?? "READY"}, ${purged}, ${options.error ?? null}, ${options.count ?? 5}, ${completed})`;
      for (let i = 0; i < (options.turns ?? 3); i++) {
        await tx.$executeRaw`INSERT INTO "Message" VALUES (${id}, 'USER', ${options.messageType ?? "USER"})`;
      }
    }
    await seed("eligible");
    await seed("popular", { turns: 8 });
    await seed("own", { owner: "viewer" });
    await seed("unpublished", { live: false });
    await seed("failed", { status: "FAILED" });
    await seed("purged", { purged: true });
    await seed("warning", { error: "build bypassed" });
    await seed("empty", { count: 0 });
    await seed("old", { age: 91 });
    await seed("too-few", { turns: 2 });
    await seed("edits-only", { turns: 10, messageType: "USER_EDIT" });
    expect(await findShowcaseSites("viewer", now, tx)).toEqual([{ slug: "popular" }, { slug: "eligible" }]);
    for (let i = 0; i < 7; i++) await seed(`extra-${i}`);
    const result = await findShowcaseSites("viewer", now, tx);
    expect(result).toHaveLength(6);
    expect(result[0]).toEqual({ slug: "popular" });
    expect(Object.keys(result[0]!)).toEqual(["slug"]);
  });
});
