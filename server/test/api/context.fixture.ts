import { beforeEach, describe, expect, mock, test } from "bun:test";
import { estimateTokens } from "@/worker/agent/context/tokens";
import { ContextCheckpointReason } from "@/generated/prisma/enums";
import type { Entry } from "@/worker/agent/context/types";

// Covers the two project-dropdown actions in context.service.ts: "Clear chat"
// and "Summarize chat" (doc/CHAT_CLEAR_SUMMARIZE_CONTEXT_UI_PLAN.md), via
// `mock.module` of `project.repository`/`loop`/`summarize`.
//
// Module mocks are process-global in Bun. `@/worker/agent/loop` is mocked
// down to just `loadHistory` here, which would otherwise break
// test/worker/balance.test.ts's real import of `balanceToolResults` from the
// same file if both ran in the same process — hence the child-runner split
// (context.test.ts), same reasoning as feedback.fixture.ts/contextFloor.fixture.ts.

interface FakeProject {
  id: string;
  userId: string;
}

let projects: Record<string, FakeProject> = {};
let activeJobs: Record<string, { id: string } | null> = {};
let maxSeqByProject: Record<string, number | null> = {};
let historyEntries: Entry[] = [];
let summarizeResult: unknown = null;
let checkpoints: Record<string, unknown>[] = [];

mock.module("@/api/repositories/project.repository", () => ({
  findProjectById: async (id: string) => projects[id] ?? null,
  findActiveJob: async (projectId: string) => activeJobs[projectId] ?? null,
  maxMessageSequence: async (projectId: string) => maxSeqByProject[projectId] ?? null,
  createContextCheckpoint: async (data: Record<string, unknown>) => {
    checkpoints.push(data);
    return { id: `cp-${checkpoints.length}`, createdAt: new Date(), ...data };
  },
}));

mock.module("@/worker/agent/loop", () => ({
  loadHistory: async (_projectId: string) => historyEntries,
}));

mock.module("@/worker/agent/context/summarize", () => ({
  summarize: async (..._args: unknown[]) => summarizeResult,
}));

const { clearProjectChat, summarizeProjectChat } = await import(
  "@/api/services/context.service"
);

beforeEach(() => {
  projects = { "proj-1": { id: "proj-1", userId: "user-1" } };
  activeJobs = {};
  maxSeqByProject = { "proj-1": 4 };
  checkpoints = [];
  historyEntries = [
    { param: { role: "user", content: "hello there" }, seq: 3 },
    { param: { role: "assistant", content: "hi, how can I help?" }, seq: 4 },
  ];
  summarizeResult = null;
});

describe("clearProjectChat", () => {
  test("404s when the project is gone", async () => {
    await expect(clearProjectChat("ghost", "user-1")).rejects.toThrow("Project not found");
  });

  test("403s for a non-owner", async () => {
    await expect(clearProjectChat("proj-1", "someone-else")).rejects.toThrow(
      "You do not have access to this project",
    );
  });

  test("409s while a job is running", async () => {
    activeJobs["proj-1"] = { id: "job-1" };
    await expect(clearProjectChat("proj-1", "user-1")).rejects.toThrow(
      "Finish or cancel the current run before you can clear this chat",
    );
    expect(checkpoints).toHaveLength(0);
  });

  test("no-ops when the project has no messages at all yet", async () => {
    maxSeqByProject["proj-1"] = null;
    const result = await clearProjectChat("proj-1", "user-1");
    expect(result).toMatchObject({ cleared: false, upToSequence: null, tokensUsed: 0 });
    expect(checkpoints).toHaveLength(0);
  });

  test("writes a MANUAL_CLEAR checkpoint at the current max sequence", async () => {
    const result = await clearProjectChat("proj-1", "user-1");

    expect(result.cleared).toBe(true);
    expect(result.upToSequence).toBe(4);
    expect(result.tokensUsed).toBe(0);
    expect(result.tokensBudget).toBeGreaterThan(0);
    expect(result.usagePercent).toBe(0);

    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0]).toMatchObject({
      projectId: "proj-1",
      upToSequence: 4,
      reason: ContextCheckpointReason.MANUAL_CLEAR,
      summary: "",
      tokensAfter: 0,
    });
    // tokensBefore reflects whatever was about to be wiped, not a hardcoded value.
    const expectedTokensBefore = estimateTokens(historyEntries.map((e) => e.param));
    expect(checkpoints[0]!.tokensBefore).toBe(expectedTokensBefore);
  });
});

describe("summarizeProjectChat", () => {
  test("404s when the project is gone", async () => {
    await expect(summarizeProjectChat("ghost", "user-1")).rejects.toThrow("Project not found");
  });

  test("403s for a non-owner", async () => {
    await expect(summarizeProjectChat("proj-1", "someone-else")).rejects.toThrow(
      "You do not have access to this project",
    );
  });

  test("409s while a job is running", async () => {
    activeJobs["proj-1"] = { id: "job-1" };
    await expect(summarizeProjectChat("proj-1", "user-1")).rejects.toThrow(
      "Finish or cancel the current run before you can summarize this chat",
    );
    expect(checkpoints).toHaveLength(0);
  });

  test("400s when there isn't enough history to summarize yet", async () => {
    summarizeResult = null;
    await expect(summarizeProjectChat("proj-1", "user-1")).rejects.toThrow(
      "Not enough chat history to summarize yet",
    );
    expect(checkpoints).toHaveLength(0);
  });

  test("writes a MANUAL_SUMMARIZE checkpoint and returns the fresh usage snapshot", async () => {
    summarizeResult = {
      entries: [],
      upToSequence: 4,
      summary: "the gist of it",
      tokensBefore: 500,
      tokensAfter: 50,
      usage: { inputTokens: 100, outputTokens: 20 },
    };

    const result = await summarizeProjectChat("proj-1", "user-1");

    expect(result).toMatchObject({
      summarized: true,
      upToSequence: 4,
      tokensBefore: 500,
      tokensAfter: 50,
      tokensUsed: 50,
    });
    expect(result.tokensBudget).toBeGreaterThan(0);
    expect(result.usagePercent).toBeCloseTo((50 / result.tokensBudget) * 100, 1);

    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0]).toMatchObject({
      projectId: "proj-1",
      upToSequence: 4,
      reason: ContextCheckpointReason.MANUAL_SUMMARIZE,
      summary: "the gist of it",
      tokensBefore: 500,
      tokensAfter: 50,
    });
  });
});
