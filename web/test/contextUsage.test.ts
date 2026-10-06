import { describe, expect, test } from "bun:test";
import { useProjectStore } from "../src/stores/useProjectStore";
import type { ProjectDetail } from "../src/features/project/types";

// Covers the context-usage ring's store wiring
// (doc/CHAT_CLEAR_SUMMARIZE_CONTEXT_UI_PLAN.md): the live `context_usage` SSE
// event, the direct `setContextUsage` write used by the clear/summarize
// mutations, and the initial value carried in from `getProject`.

const baseDetail: ProjectDetail = {
  project: {
    id: "p1",
    name: "Test",
    description: null,
    tags: [],
    sandboxStatus: "NONE",
    workspaceStartedAt: null,
    previewImageUrl: null,
  },
  messages: [],
  latestFragment: null,
  activeJobId: null,
  activeJobEventIndex: null,
  jobState: null,
  checkpoints: [],
  contextUsage: { tokensUsed: 123, tokensBudget: 600_000, usagePercent: 0.02 },
};

describe("context_usage SSE event", () => {
  test("updates the usage snapshot without flashing on a plain turn", () => {
    useProjectStore.getState().initProject("ctx-plain-turn");
    useProjectStore.getState().applyEvent({
      type: "context_usage",
      usagePercent: 12.3,
      tokensUsed: 1000,
      tokensBudget: 600_000,
    });
    const s = useProjectStore.getState();
    expect(s.contextUsage).toEqual({ usagePercent: 12.3, tokensUsed: 1000, tokensBudget: 600_000 });
    expect(s.contextUsageFlashKind).toBeNull();
  });

  test("flashes and bumps the token when an auto-run fires", () => {
    useProjectStore.getState().initProject("ctx-auto-run");
    const before = useProjectStore.getState().contextUsageFlashToken;
    useProjectStore.getState().applyEvent({
      type: "context_usage",
      usagePercent: 61,
      tokensUsed: 366_000,
      tokensBudget: 600_000,
      triggeredAutoRun: "compact",
    });
    const s = useProjectStore.getState();
    expect(s.contextUsageFlashKind).toBe("compact");
    expect(s.contextUsageFlashToken).toBe(before + 1);
  });

  test("a second same-kind auto-run still bumps the token, so a repeat re-flashes", () => {
    useProjectStore.getState().initProject("ctx-repeat-run");
    useProjectStore.getState().applyEvent({
      type: "context_usage",
      usagePercent: 76,
      tokensUsed: 456_000,
      tokensBudget: 600_000,
      triggeredAutoRun: "summarize",
    });
    const firstToken = useProjectStore.getState().contextUsageFlashToken;
    useProjectStore.getState().applyEvent({
      type: "context_usage",
      usagePercent: 61,
      tokensUsed: 366_000,
      tokensBudget: 600_000,
      triggeredAutoRun: "summarize",
    });
    expect(useProjectStore.getState().contextUsageFlashToken).toBe(firstToken + 1);
  });
});

describe("setContextUsage (manual clear/summarize action)", () => {
  test("applies the snapshot with no flash — the user already knows why", () => {
    useProjectStore.getState().initProject("ctx-manual-clear");
    const before = useProjectStore.getState().contextUsageFlashToken;
    useProjectStore.getState().setContextUsage({ tokensUsed: 0, tokensBudget: 600_000, usagePercent: 0 });
    const s = useProjectStore.getState();
    expect(s.contextUsage).toEqual({ tokensUsed: 0, tokensBudget: 600_000, usagePercent: 0 });
    expect(s.contextUsageFlashToken).toBe(before);
  });
});

describe("initial load", () => {
  test("hydrate carries getProject's contextUsage snapshot into the store", () => {
    useProjectStore.getState().initProject("ctx-hydrate");
    useProjectStore.getState().hydrate(baseDetail);
    expect(useProjectStore.getState().contextUsage).toEqual(baseDetail.contextUsage);
  });

  test("resyncFromDetail carries it too", () => {
    useProjectStore.getState().initProject("ctx-resync");
    useProjectStore.getState().resyncFromDetail({
      ...baseDetail,
      contextUsage: { tokensUsed: 9, tokensBudget: 600_000, usagePercent: 0.0015 },
    });
    expect(useProjectStore.getState().contextUsage).toEqual({
      tokensUsed: 9,
      tokensBudget: 600_000,
      usagePercent: 0.0015,
    });
  });

  test("a fresh project starts with no usage snapshot yet", () => {
    useProjectStore.getState().initProject("ctx-fresh");
    expect(useProjectStore.getState().contextUsage).toBeNull();
  });
});
