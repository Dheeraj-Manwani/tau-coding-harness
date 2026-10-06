import { beforeEach, describe, expect, test, mock } from "bun:test";

// Regression coverage for doc/CHAT_CLEAR_SUMMARIZE_CONTEXT_UI_PLAN.md: every
// message-read path must floor on the latest MANUAL_CLEAR checkpoint, so a
// cleared chat never resurfaces after a reload. AUTO_SUMMARIZE/MANUAL_SUMMARIZE
// checkpoints must NOT floor — they stay purely cosmetic (a divider).

interface FakeMessage {
  id: string;
  projectId: string;
  sequence: number;
  type: string;
}
interface FakeCheckpoint {
  projectId: string;
  reason: string;
  upToSequence: number;
}

let messages: FakeMessage[] = [];
let checkpoints: FakeCheckpoint[] = [];

function applyWhere(rows: FakeMessage[], where: Record<string, unknown>): FakeMessage[] {
  let out = rows.filter((m) => m.projectId === where.projectId);
  const seq = where.sequence as { gt?: number; lt?: number } | undefined;
  if (seq?.gt !== undefined) out = out.filter((m) => m.sequence > seq.gt!);
  if (seq?.lt !== undefined) out = out.filter((m) => m.sequence < seq.lt!);
  const type = where.type as { not?: string } | undefined;
  if (type?.not !== undefined) out = out.filter((m) => m.type !== type.not);
  return out;
}

mock.module("@/lib/prisma", () => ({
  prisma: {
    message: {
      findMany: async ({
        where,
        orderBy,
        take,
      }: {
        where: Record<string, unknown>;
        orderBy: { sequence: "asc" | "desc" };
        take?: number;
      }) => {
        let rows = applyWhere(messages, where);
        rows = [...rows].sort((a, b) =>
          orderBy.sequence === "asc" ? a.sequence - b.sequence : b.sequence - a.sequence,
        );
        if (take !== undefined) rows = rows.slice(0, take);
        return rows.map((r) => ({ ...r, attachments: [] }));
      },
    },
    contextCheckpoint: {
      findFirst: async ({
        where,
        orderBy,
      }: {
        where: { projectId: string; reason?: string };
        orderBy: { upToSequence: "asc" | "desc" };
      }) => {
        let rows = checkpoints.filter(
          (c) => c.projectId === where.projectId && (!where.reason || c.reason === where.reason),
        );
        rows = [...rows].sort((a, b) =>
          orderBy.upToSequence === "desc"
            ? b.upToSequence - a.upToSequence
            : a.upToSequence - b.upToSequence,
        );
        return rows[0] ?? null;
      },
    },
  },
}));

const projectRepo = await import("@/api/repositories/project.repository");

beforeEach(() => {
  // seq 0-2 are "before the clear", 3-4 are "after" — the shape every test
  // below floors against.
  messages = [0, 1, 2, 3, 4].map((sequence) => ({
    id: `m${sequence}`,
    projectId: "p1",
    sequence,
    type: "USER",
  }));
  checkpoints = [{ projectId: "p1", reason: "MANUAL_CLEAR", upToSequence: 2 }];
});

describe("findLatestClearSequence", () => {
  test("finds the MANUAL_CLEAR boundary", async () => {
    expect(await projectRepo.findLatestClearSequence("p1")).toBe(2);
  });

  test("returns -1 (no floor) when the project was never cleared", async () => {
    checkpoints = [];
    expect(await projectRepo.findLatestClearSequence("p1")).toBe(-1);
  });

  test("ignores AUTO_SUMMARIZE / MANUAL_SUMMARIZE checkpoints entirely", async () => {
    checkpoints = [{ projectId: "p1", reason: "AUTO_SUMMARIZE", upToSequence: 4 }];
    expect(await projectRepo.findLatestClearSequence("p1")).toBe(-1);
  });
});

describe("message read paths respect the clear floor", () => {
  test("findRecentMessages hides everything at/before the floor", async () => {
    const rows = await projectRepo.findRecentMessages("p1", 50, 2);
    expect(rows.map((r) => r.sequence)).toEqual([3, 4]);
  });

  test("findRecentMessages returns everything when there is no floor", async () => {
    const rows = await projectRepo.findRecentMessages("p1", 50, -1);
    expect(rows.map((r) => r.sequence)).toEqual([0, 1, 2, 3, 4]);
  });

  test("findMessagesBefore combines the pagination cursor with the clear floor", async () => {
    const { messages: rows, hasMore } = await projectRepo.findMessagesBefore("p1", 10, 50, 2);
    expect(rows.map((r) => r.sequence)).toEqual([3, 4]);
    expect(hasMore).toBe(false);
  });

  test("listMessages hides everything at/before the floor", async () => {
    const { messages: rows } = await projectRepo.listMessages("p1", { limit: 50 }, 2);
    expect(rows.map((r) => r.sequence)).toEqual([3, 4]);
  });

  test("listMessages returns everything when there is no floor", async () => {
    const { messages: rows } = await projectRepo.listMessages("p1", { limit: 50 }, -1);
    expect(rows.map((r) => r.sequence)).toEqual([0, 1, 2, 3, 4]);
  });
});
