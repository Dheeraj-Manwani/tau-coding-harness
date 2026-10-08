import { afterAll, describe, expect, test } from "bun:test";
import { prisma } from "@/lib/prisma";
import { noteInsights, noteReview, type JobInsights } from "@/worker/lib/jobInsights";

// What a run records for the admin job page, against a real database in rows of
// their own. Skipped where there is none.

const dbUp = await prisma
  .$queryRaw`SELECT 1`
  .then(() => true)
  .catch(() => false);
const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let userId = "";

const review = (verdict: string) => ({
  verdict, routes: ["/"], screens: 2, steps: 1, reference: false, captureMs: 10, modelMs: 20,
});

describe.skipIf(!dbUp)("a run's insights", () => {
  afterAll(async () => {
    if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  });

  test("are merged key by key, and reviews are added to a list", async () => {
    const user = await prisma.user.create({ data: { email: `insights-${stamp}@test.local` } });
    userId = user.id;
    const project = await prisma.project.create({ data: { name: "Insights", userId } });
    const job = await prisma.job.create({ data: { projectId: project.id, prompt: "x" } });
    const read = async () => (await prisma.job.findUnique({ where: { id: job.id } }))!.insights as JobInsights | null;

    expect(await read()).toBeNull();
    await noteReview(job.id, review("fix"));
    await noteInsights(job.id, { summaries: 1 });
    await noteReview(job.id, review("pass"));
    await noteInsights(job.id, { cache: { turns: 3, inputTokens: 100, cachedTokens: 90, cachedPct: 90 } });

    const got = await read();
    expect(got?.reviews?.map((r) => r.verdict)).toEqual(["fix", "pass"]);
    expect(got?.summaries).toBe(1);
    expect(got?.cache?.cachedPct).toBe(90);

    // A job that is gone is not an error: the note is simply nowhere to go.
    await prisma.job.delete({ where: { id: job.id } });
    await noteInsights(job.id, { summaries: 2 });
  });
});
