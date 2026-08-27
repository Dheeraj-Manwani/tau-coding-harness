import { beforeEach, describe, expect, test } from "bun:test";

import { useProjectStore } from "@/src/stores/useProjectStore";

describe("todo action display", () => {
  beforeEach(() => {
    useProjectStore.setState({
      chatMessages: [
        {
          id: "user-1",
          role: "user",
          content: "Build it",
          timestamp: 1,
        },
        {
          id: "assistant-1",
          role: "ai",
          content: "I’ll work through this plan.",
          timestamp: 2,
          actions: [
            {
              kind: "create_plan",
              label: "Build project",
              meta: {
                description: "The implementation plan",
                todos: ["Create the interface", "Verify the result"],
              },
            },
          ],
        },
      ],
      currentPlan: {
        name: "Build project",
        description: "The implementation plan",
        todos: [
          { sno: 1, label: "Create the interface", status: "pending" },
          { sno: 2, label: "Verify the result", status: "pending" },
        ],
      },
      streamingId: null,
    });
  });

  test("checks the item off in the existing plan instead of appending an update card", () => {
    useProjectStore.getState().applyEvent({
      type: "tool_req",
      index: 1,
      toolName: "update_todo",
      toolCallId: "todo-1",
      input: { sno: 1, status: "done" },
    });

    const messages = useProjectStore.getState().chatMessages;
    const actions = messages[1].actions ?? [];
    expect(actions.map((action) => action.kind)).toEqual(["create_plan"]);
    expect(actions[0].meta?.todos).toEqual([
      { sno: 1, label: "Create the interface", status: "done" },
      { sno: 2, label: "Verify the result", status: "pending" },
    ]);
  });
});
