import { beforeEach, describe, expect, mock, test } from "bun:test";

// The orphan-sandbox kill is the console's only new destructive action, so its
// refusals are pinned here: a sandbox a running job holds, one a project points
// at (someone's live preview), and one young enough to still be provisioning
// must never be killed. E2B and the database are faked; the job bus is real.

const MIN = 60_000;
let live: Array<{ sandboxId: string; state: string; startedAt: Date }> = [];
let projects: Array<{ id: string; name: string; userId: string; sandboxId: string; sandboxStatus: string }> = [];
const killed: string[] = [];

const sandbox = (sandboxId: string, ageMs: number, state = "running") => ({
  sandboxId,
  state,
  startedAt: new Date(Date.now() - ageMs),
});

mock.module("e2b", () => ({
  Sandbox: {
    list: () => {
      let done = false;
      return {
        get hasNext() {
          return !done;
        },
        nextItems: async () => {
          done = true;
          return live.map((s) => ({
            ...s,
            templateId: "vite-hono-app",
            name: "vite-hono-app",
            endAt: new Date(Date.now() + 10 * MIN),
            cpuCount: 2,
            memoryMB: 2048,
            metadata: {},
          }));
        },
      };
    },
    getInfo: async (id: string) => {
      const s = live.find((x) => x.sandboxId === id);
      if (!s) throw new Error("not found");
      return s;
    },
    kill: async (id: string) => {
      killed.push(id);
      return true;
    },
  },
}));

mock.module("@/lib/prisma", () => ({
  prisma: {
    project: {
      findFirst: async ({ where }: { where: { sandboxId: string } }) =>
        projects.find((p) => p.sandboxId === where.sandboxId) ?? null,
      findMany: async ({ where }: { where: { sandboxId?: { in?: string[] }; sandboxStatus?: string } }) => {
        const rows = where.sandboxId?.in
          ? projects.filter((p) => where.sandboxId!.in!.includes(p.sandboxId))
          : projects.filter((p) => p.sandboxStatus === where.sandboxStatus);
        return rows.map((p) => ({ ...p, updatedAt: new Date(), user: { email: `${p.userId}@example.com` } }));
      },
    },
  },
}));

const { bus } = await import("@/lib/bus");
const { clearMemo } = await import("@/api/lib/memo");
const { killOrphanSandbox, getLiveSandboxes } = await import("@/api/services/adminOverview.service");

beforeEach(() => {
  live = [];
  projects = [];
  killed.length = 0;
  clearMemo();
  for (const e of bus.registrySnapshot()) bus.clearResident(e.jobId);
});

const statusOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return 200;
  } catch (err) {
    return (err as { statusCode?: number }).statusCode ?? 500;
  }
};

describe("killOrphanSandbox", () => {
  test("kills an orphan older than the provisioning window", async () => {
    live = [sandbox("sbx-orphan", 30 * MIN)];
    expect(await killOrphanSandbox("sbx-orphan")).toEqual({ killed: true });
    expect(killed).toEqual(["sbx-orphan"]);
  });

  test("refuses a sandbox a running job is using", async () => {
    live = [sandbox("sbx-busy", 30 * MIN)];
    bus.markResident("job-1", { sandboxId: "sbx-busy" });
    expect(await statusOf(killOrphanSandbox("sbx-busy"))).toBe(409);
    expect(killed).toEqual([]);
  });

  test("refuses a sandbox a project points at — that is a live preview", async () => {
    live = [sandbox("sbx-preview", 30 * MIN)];
    projects = [{ id: "p1", name: "App", userId: "u1", sandboxId: "sbx-preview", sandboxStatus: "READY" }];
    expect(await statusOf(killOrphanSandbox("sbx-preview"))).toBe(409);
    expect(killed).toEqual([]);
  });

  test("refuses a sandbox still inside the provisioning window", async () => {
    live = [sandbox("sbx-young", 5 * MIN)];
    expect(await statusOf(killOrphanSandbox("sbx-young"))).toBe(409);
    expect(killed).toEqual([]);
  });

  test("404s for a sandbox E2B doesn't know", async () => {
    expect(await statusOf(killOrphanSandbox("sbx-ghost"))).toBe(404);
    expect(killed).toEqual([]);
  });
});

describe("getLiveSandboxes", () => {
  test("classifies orphans, owned, busy, young and stale rows", async () => {
    live = [
      sandbox("sbx-orphan", 30 * MIN),
      sandbox("sbx-paused-orphan", 30 * MIN, "paused"),
      sandbox("sbx-owned", 30 * MIN),
      sandbox("sbx-busy", 30 * MIN),
      sandbox("sbx-young", 2 * MIN),
    ];
    projects = [
      { id: "p1", name: "Owned", userId: "u1", sandboxId: "sbx-owned", sandboxStatus: "READY" },
      { id: "p2", name: "Stale", userId: "u2", sandboxId: "sbx-gone", sandboxStatus: "READY" },
    ];
    bus.markResident("job-1", { sandboxId: "sbx-busy" });

    const r = await getLiveSandboxes(true);
    const orphanIds = r.sandboxes.filter((s) => s.orphan).map((s) => s.sandboxId).sort();

    expect(orphanIds).toEqual(["sbx-orphan", "sbx-paused-orphan"]);
    // Paused sandboxes don't bill compute, so only running orphans count as a leak.
    expect(r.orphans).toBe(1);
    expect(r.running).toBe(4);
    expect(r.paused).toBe(1);
    expect(r.sandboxes.find((s) => s.sandboxId === "sbx-owned")?.project?.id).toBe("p1");
    expect(r.sandboxes.find((s) => s.sandboxId === "sbx-busy")?.residentJobId).toBe("job-1");
    expect(r.stale.map((s) => s.projectId)).toEqual(["p2"]);
    // Orphans sort first.
    expect(r.sandboxes[0]?.orphan).toBe(true);
  });
});
