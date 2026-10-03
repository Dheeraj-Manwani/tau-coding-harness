import { describe, expect, test } from "bun:test";
import { useProjectStore } from "../src/stores/useProjectStore";
import { queryClient } from "../src/lib/query-client";
import type { ProjectDetail } from "../src/features/project/types";

const question = { id: "q1", question: "Which layout?", options: ["Grid", "List"] };
const detail: ProjectDetail = {
  project: {
    id: "p1", name: "Test", description: null, tags: [],
    sandboxStatus: "NONE", workspaceStartedAt: null,
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
  test("enabling the inspector closes the theme panel", () => {
    useProjectStore.getState().initProject("inspector-mode");
    useProjectStore.getState().setThemePanelOpen(true);
    useProjectStore.getState().setVisualEditEnabled(true);
    expect(useProjectStore.getState()).toMatchObject({
      visualEditEnabled: true,
      themePanelOpen: false,
    });
  });

  test("opening the theme panel disables the inspector and clears its selection", () => {
    useProjectStore.getState().initProject("theme-mode");
    useProjectStore.getState().setVisualEditEnabled(true);
    useProjectStore.getState().setVisualSelection({
      loc: "src/App.tsx:1:1", tagName: "button", className: "",
      text: "Click me", editableText: true, siblingCount: 1,
    });
    useProjectStore.getState().setThemePanelOpen(true);
    expect(useProjectStore.getState()).toMatchObject({
      themePanelOpen: true,
      visualEditEnabled: false,
      visualSelection: null,
    });
  });

  test("closing either tool does not enable the other tool", () => {
    useProjectStore.getState().initProject("close-tools");
    useProjectStore.getState().setThemePanelOpen(true);
    useProjectStore.getState().setThemePanelOpen(false);
    expect(useProjectStore.getState().visualEditEnabled).toBe(false);
    useProjectStore.getState().setVisualEditEnabled(true);
    useProjectStore.getState().setVisualEditEnabled(false);
    expect(useProjectStore.getState().themePanelOpen).toBe(false);
  });

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

  test("a preview restart's status line does not show the chat shimmer", () => {
    useProjectStore.getState().initProject("preview-shimmer");
    useProjectStore.getState().startPreviewJob("preview-job");

    useProjectStore.getState().applyEvent({
      type: "thinking",
      message: "Starting preview",
      index: 0,
    });

    expect(useProjectStore.getState()).toMatchObject({
      currentJobId: "preview-job",
      status: "streaming",
      isAiTyping: false,
      activity: null,
    });
  });

  test("a generation job's status line still shows the chat shimmer", () => {
    useProjectStore.getState().initProject("gen-shimmer");
    useProjectStore.getState().startJob("gen-job");

    useProjectStore.getState().applyEvent({
      type: "thinking",
      message: "Reading files",
      index: 0,
    });

    expect(useProjectStore.getState()).toMatchObject({
      isAiTyping: true,
      activity: "Reading files",
    });
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
