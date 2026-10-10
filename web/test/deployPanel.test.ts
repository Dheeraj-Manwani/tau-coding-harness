import { describe, expect, test } from "bun:test";
import {
  deployedAgo,
  historyLabel,
  publishFailureError,
  publishLabel,
  type DeployStatus,
  type DeploymentSummary,
} from "../src/features/project/deploy";

// The words the Publish panel puts on a site's state, and what its "Fix with
// tau" button hands the agent. Pure functions of the status the API returns.

function deployment(over: Partial<DeploymentSummary> = {}): DeploymentSummary {
  return {
    id: "d1",
    status: "SUPERSEDED",
    fileCount: 12,
    sizeBytes: 340_000,
    error: null,
    createdAt: "2026-10-09T10:00:00.000Z",
    completedAt: "2026-10-09T10:01:00.000Z",
    isLive: false,
    canRollback: true,
    ...over,
  };
}

function status(over: Partial<DeployStatus> = {}): DeployStatus {
  const live = deployment({ id: "live", status: "READY", isLive: true, canRollback: false });
  return {
    slug: "my-app-ab12cd",
    url: "https://my-app-ab12cd.usetau.app",
    live,
    deployments: [live],
    inProgress: false,
    unpublishedChanges: 0,
    serverWarning: null,
    databasePublished: false,
    suspended: null,
    lastFailure: null,
    ...over,
  };
}

describe("the line under the Publish button", () => {
  test("a live site is up to date or counts its changes", () => {
    expect(publishLabel(status())).toBe("Up to date");
    expect(publishLabel(status({ unpublishedChanges: 1 }))).toBe("1 change since last publish");
    expect(publishLabel(status({ unpublishedChanges: 4 }))).toBe("4 changes since last publish");
  });

  test("a project that never published is not called offline", () => {
    expect(publishLabel(status({ slug: null, url: null, live: null, deployments: [] }))).toBe(
      "Not published yet",
    );
    // A first publish that failed never went live either.
    expect(
      publishLabel(status({ live: null, deployments: [deployment({ status: "FAILED", canRollback: false })] })),
    ).toBe("Not published yet");
  });

  test("a site taken offline says so", () => {
    expect(publishLabel(status({ live: null, deployments: [deployment()] }))).toBe("Offline");
  });

  // Suspended wins: nothing else about the site is true for a visitor.
  test("a suspended site says so whatever else is going on", () => {
    expect(publishLabel(status({ suspended: { reason: null }, unpublishedChanges: 3 }))).toBe("Suspended");
    expect(publishLabel(status({ suspended: { reason: "Reported." }, live: null }))).toBe("Suspended");
  });
});

describe("a row of the history", () => {
  test("is named for what can be done with it", () => {
    expect(historyLabel(deployment({ status: "READY", isLive: true, canRollback: false }))).toBe("Live");
    expect(historyLabel(deployment())).toBe("Earlier version");
    expect(historyLabel(deployment({ canRollback: false }))).toBe("Expired");
    expect(historyLabel(deployment({ status: "FAILED", canRollback: false }))).toBe("Failed");
    expect(historyLabel(deployment({ status: "BUILDING", canRollback: false }))).toBe("Publishing");
  });

  test("says when, briefly", () => {
    const at = "2026-10-09T10:00:00.000Z";
    const after = (ms: number) => new Date(at).getTime() + ms;
    expect(deployedAgo(at, after(20_000))).toBe("just now");
    expect(deployedAgo(at, after(5 * 60_000))).toBe("5m ago");
    expect(deployedAgo(at, after(3 * 3_600_000))).toBe("3h ago");
    expect(deployedAgo(at, after(2 * 86_400_000))).toBe("2d ago");
    // A clock that is a little behind the server's must not read as the future.
    expect(deployedAgo(at, after(-30_000))).toBe("just now");
    expect(deployedAgo(at, after(90 * 86_400_000))).not.toContain("ago");
  });
});

describe("what Fix with tau sends for a failed publish", () => {
  const error = "The build failed. Ask the agent to fix the errors, then publish again.";

  test("marks it as a publish failure and carries the error and the log", () => {
    expect(
      publishFailureError({ error, buildLog: "error TS1005: '}' expected.", changedSince: false }),
    ).toEqual({ source: "publish", message: error, frame: "error TS1005: '}' expected." });
  });

  test("leaves the log out when there is none", () => {
    expect(publishFailureError({ error, buildLog: null, changedSince: false })).toEqual({
      source: "publish",
      message: error,
    });
    expect(publishFailureError({ error, buildLog: "  \n", changedSince: false })).not.toHaveProperty("frame");
  });

  // The API rejects a frame over 4000 characters, and the stored log is a
  // 4000-character tail with a marker in front, so it is always a little over.
  // The error a build stops on is at the end.
  test("keeps the end of a long log within the API's limit", () => {
    const buildLog = `…\n${"x".repeat(3_990)}THE ERROR`;
    const sent = publishFailureError({ error, buildLog, changedSince: false });
    expect(sent.frame).toHaveLength(4000);
    expect(sent.frame).toEndWith("THE ERROR");
  });
});
