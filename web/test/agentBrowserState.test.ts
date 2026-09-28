import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  agentFaviconHref,
  FAVICON_APPEARANCE,
  resolveAgentBrowserState,
} from "../src/features/project/agentBrowserState";

describe("resolveAgentBrowserState", () => {
  test("shows a blinking working state for an active turn", () => {
    expect(
      resolveAgentBrowserState({
        status: "streaming",
        pendingQuestion: false,
        stalled: false,
      }),
    ).toBe("working");
  });

  test("stays idle while a preview restart or deploy runs", () => {
    expect(
      resolveAgentBrowserState({
        status: "streaming",
        pendingQuestion: false,
        stalled: false,
        previewJob: true,
      }),
    ).toBe("idle");
  });

  test("prioritizes user input and stalled states over generic work", () => {
    expect(
      resolveAgentBrowserState({
        status: "streaming",
        pendingQuestion: true,
        stalled: true,
      }),
    ).toBe("waiting");
    expect(
      resolveAgentBrowserState({
        status: "streaming",
        pendingQuestion: false,
        stalled: true,
      }),
    ).toBe("stalled");
  });

  test.each([
    ["idle", "idle"],
    ["done", "idle"],
    ["error", "error"],
    ["cancelled", "cancelled"],
  ] as const)("maps %s to %s", (status, expected) => {
    expect(
      resolveAgentBrowserState({
        status,
        pendingQuestion: false,
        stalled: false,
      }),
    ).toBe(expected);
  });
});

test("agent favicon frames only use static public assets", () => {
  const on = agentFaviconHref("working", true);
  const off = agentFaviconHref("working", false);
  expect(on).toBe("/favicon-working.svg");
  expect(off).toBe("/favicon.ico");

  for (const appearance of Object.values(FAVICON_APPEARANCE)) {
    expect(appearance.href.startsWith("/favicon-")).toBe(true);
    expect(
      existsSync(join(import.meta.dir, "..", "public", appearance.href.slice(1))),
    ).toBe(true);
  }
});
