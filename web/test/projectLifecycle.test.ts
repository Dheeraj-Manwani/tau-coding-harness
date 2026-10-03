import { describe, expect, test } from "bun:test";
import { lifecycleFromDetail } from "../src/features/project/projectLifecycle";
import type { ProjectDetail } from "../src/features/project/types";

const base: ProjectDetail = {
  project: {
    id: "p", name: "Test", description: null, tags: [],
    sandboxStatus: "NONE", workspaceStartedAt: null,
    previewImageUrl: null,
  },
  messages: [],
  latestFragment: null,
  activeJobId: null,
  activeJobEventIndex: null,
  jobState: null,
  checkpoints: [],
};

describe("project lifecycle snapshot", () => {
  test("restores an unanswered question without a thinking shimmer", () => {
    const question = { id: "q", question: "Which style?", options: ["Simple", "Bold"] };
    const state = lifecycleFromDetail({
      ...base,
      activeJobId: "j",
      activeJobEventIndex: 7,
      jobState: {
        id: "j", type: "GENERATION", status: "RUNNING", phase: "waiting_user",
        finishReason: null, error: null, pendingQuestion: question,
      },
    });
    expect(state).toMatchObject({
      currentJobId: "j", status: "streaming", isAiTyping: false,
      pendingQuestion: question,
    });
  });

  test("restores normal work and terminal reasons accurately", () => {
    expect(lifecycleFromDetail({
      ...base,
      activeJobId: "j",
      jobState: {
        id: "j", type: "GENERATION", status: "RUNNING", phase: "working",
        finishReason: null, error: null, pendingQuestion: null,
      },
    }).isAiTyping).toBe(true);

    expect(lifecycleFromDetail({
      ...base,
      jobState: {
        id: "j", type: "GENERATION", status: "COMPLETED", phase: "terminal",
        finishReason: "INSUFFICIENT_CREDITS", error: null, pendingQuestion: null,
      },
    }).terminalOutcome).toEqual({ kind: "credits", reason: "balance" });
  });
});
