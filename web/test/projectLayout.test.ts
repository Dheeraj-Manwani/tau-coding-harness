import { describe, expect, test } from "bun:test";

import { resolveProjectLayout } from "../src/features/project/projectLayout";

const base = {
  liveBuildStarted: false,
  workspaceStartedAt: null,
  hasPreviewFragment: false,
  detailPending: false,
  freshBuild: false,
};

describe("resolveProjectLayout", () => {
  test("keeps a new project chat-only before output exists", () => {
    expect(resolveProjectLayout({ ...base, freshBuild: true })).toBe("chat");
    expect(resolveProjectLayout(base)).toBe("chat");
  });

  test("reveals the workspace on the first live build event", () => {
    expect(
      resolveProjectLayout({ ...base, liveBuildStarted: true }),
    ).toBe("workspace");
  });

  test("restores the workspace from durable state after refresh", () => {
    expect(
      resolveProjectLayout({
        ...base,
        workspaceStartedAt: "2026-09-22T12:00:00.000Z",
      }),
    ).toBe("workspace");
  });

  test("supports existing projects that already have a preview", () => {
    expect(
      resolveProjectLayout({ ...base, hasPreviewFragment: true }),
    ).toBe("workspace");
  });

  test("uses a neutral state while refreshed project data loads", () => {
    expect(resolveProjectLayout({ ...base, detailPending: true })).toBe(
      "loading",
    );
    expect(
      resolveProjectLayout({
        ...base,
        detailPending: true,
        freshBuild: true,
      }),
    ).toBe("chat");
  });
});
