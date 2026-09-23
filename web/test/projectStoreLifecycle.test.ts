import { describe, expect, test } from "bun:test";
import { useProjectStore } from "../src/stores/useProjectStore";
import { queryClient } from "../src/lib/query-client";
import type { ProjectDetail } from "../src/features/project/types";

const question = { id: "q1", question: "Which layout?", options: ["Grid", "List"] };
const detail: ProjectDetail = {
  project: {
    id: "p1", name: "Test", sandboxStatus: "NONE", workspaceStartedAt: null,
    previewImageUrl: "https://images.example.test/cover.png",
  },
  messages: [],
  latestFragment: null,
  activeJobId: "j1",
  activeJobEventIndex: 4,
  jobState: {
    id: "j1", type: "GENERATION", status: "RUNNING", phase: "waiting_user",
    finishReason: null, error: null, pendingQuestion: question,
  },
  checkpoints: [],
};

describe("project store lifecycle reconciliation", () => {
  test("reload restores the answer prompt and unblocks the thinking shimmer", () => {
    useProjectStore.getState().initProject("p1");
    useProjectStore.getState().hydrate(detail);
    expect(useProjectStore.getState()).toMatchObject({
      currentJobId: "j1", status: "streaming", pendingQuestion: question,
      isAiTyping: false,
      previewImageUrl: "https://images.example.test/cover.png",
    });
  });

  test("a missed answer transition is corrected by a fresh snapshot", () => {
    useProjectStore.getState().initProject("p2");
    useProjectStore.getState().startJob("j1");
    useProjectStore.getState().resyncFromDetail(detail);
    expect(useProjectStore.getState().pendingQuestion).toEqual(question);
    expect(useProjectStore.getState().isAiTyping).toBe(false);
  });

  test("preview_ready makes the new iframe usable before the restart job ends", () => {
    useProjectStore.getState().initProject("preview-project");
    queryClient.setQueryData(
      ["project", "preview-project", "preview-status"],
      { alive: false },
    );
    useProjectStore.getState().startPreviewJob("preview-job");
    expect(useProjectStore.getState().previewReadyJobId).toBeNull();

    useProjectStore.getState().applyEvent({
      type: "preview_ready",
      url: "https://preview.example.test",
    });

    expect(useProjectStore.getState()).toMatchObject({
      currentJobId: "preview-job",
      status: "streaming",
      previewReadyJobId: "preview-job",
      previewUrl: "https://preview.example.test",
    });
    expect(queryClient.getQueryData(["project", "preview-project", "preview-status"])).toEqual({ alive: true });
  });
});
