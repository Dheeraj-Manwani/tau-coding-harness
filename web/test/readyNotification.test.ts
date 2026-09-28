import { describe, expect, test } from "bun:test";

import {
  getInputNotificationCopy,
  getReadyNotificationCopy,
} from "../src/features/project/readyNotificationCopy";

test("input notifications include a concise version of the question", () => {
  expect(getInputNotificationCopy("Which database should I use?")).toEqual({
    title: "Tau needs your input",
    body: "Which database should I use?",
  });
});

describe("notification copy names the project", () => {
  test("uses the project's name when there is one", () => {
    expect(getReadyNotificationCopy({ kind: "done" }, "done", "Todo app")).toEqual({
      title: "Todo app is ready",
      body: "Tau has finished working on it.",
    });
    expect(
      getReadyNotificationCopy({ kind: "error", message: "boom" }, "error", "Todo app")
        ?.title,
    ).toBe("Tau couldn’t finish Todo app");
    expect(getInputNotificationCopy("Grid or list?", "Todo app").title).toBe(
      "Todo app needs your input",
    );
  });

  test("keeps every letter of the name, collapsing only whitespace", () => {
    expect(
      getReadyNotificationCopy({ kind: "done" }, "done", "  Sales   dashboard ")
        ?.title,
    ).toBe("Sales dashboard is ready");
  });

  test("shortens a very long name and falls back when it's blank", () => {
    const title = getReadyNotificationCopy({ kind: "done" }, "done", "x".repeat(80))
      ?.title;
    expect(title?.startsWith(`${"x".repeat(39)}…`)).toBe(true);
    expect(getReadyNotificationCopy({ kind: "done" }, "done", "   ")?.title).toBe(
      "Your Tau project is ready",
    );
  });
});

describe("getReadyNotificationCopy", () => {
  test("covers successful completion", () => {
    expect(getReadyNotificationCopy({ kind: "done" }, "done")).toEqual({
      title: "Your Tau project is ready",
      body: "Tau has finished working on your project.",
    });
  });

  test("tells an exhausted account to add credits", () => {
    expect(
      getReadyNotificationCopy(
        { kind: "credits", reason: "balance" },
        "error",
      ),
    ).toEqual({
      title: "Tau stopped: credits ran out",
      body: "Add credits, then send another message to continue.",
    });
  });

  test("tells a budget-limited run it can continue", () => {
    expect(
      getReadyNotificationCopy(
        { kind: "credits", reason: "budget" },
        "error",
      ),
    ).toEqual({
      title: "Tau reached this run’s limit",
      body: "Send another message to continue where it left off.",
    });
  });

  test("covers cancellation", () => {
    expect(
      getReadyNotificationCopy({ kind: "cancelled" }, "cancelled"),
    ).toEqual({
      title: "Tau stopped",
      body: "The run was cancelled before it finished.",
    });
  });

  test("shows a concise failure reason", () => {
    expect(
      getReadyNotificationCopy(
        { kind: "error", message: "  Sandbox   could not be restored.  " },
        "error",
      ),
    ).toEqual({
      title: "Tau couldn’t finish",
      body: "Sandbox could not be restored.",
    });
  });
});
