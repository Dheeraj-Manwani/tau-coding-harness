import { describe, expect, test } from "bun:test";

import { GAMES, gameEmbedUrl } from "@/src/features/project/games";
import { getGamesStatus } from "@/src/features/project/gamesStatus";

const base = {
  status: "streaming" as const,
  hydrated: true,
  activity: null,
  isStalled: false,
  waitingForAnswer: false,
  interruptedForCredits: false,
  availableCredits: 10,
  hasPreview: false,
};

describe("games modal status bar", () => {
  test("repeats what tau is doing while it builds", () => {
    expect(
      getGamesStatus({ ...base, activity: "Tau is designing the navigation" }),
    ).toEqual({ tone: "working", label: "tau is designing the navigation…" });
  });

  test("keeps saying tau is working once the preview is up mid-build", () => {
    expect(getGamesStatus({ ...base, hasPreview: true })).toEqual({
      tone: "working",
      label: "tau is building your app…",
    });
  });

  test("says tau is done and offers the preview", () => {
    expect(
      getGamesStatus({ ...base, status: "done", hasPreview: true }),
    ).toEqual({
      tone: "done",
      label: "tau is done. Your preview is ready.",
      actionLabel: "View preview",
    });
  });

  test("does not promise a preview that was never created", () => {
    expect(getGamesStatus({ ...base, status: "done" })).toEqual({
      tone: "done",
      label: "tau is done.",
      actionLabel: "Back to tau",
    });
  });

  test("calls the player back when tau is waiting on an answer", () => {
    expect(getGamesStatus({ ...base, waitingForAnswer: true })).toEqual({
      tone: "attention",
      label: "Waiting for your answer",
      actionLabel: "Back to tau",
    });
  });

  test("reports a failed, stalled or stopped build instead of 'done'", () => {
    expect(getGamesStatus({ ...base, status: "error" })).toMatchObject({
      tone: "attention",
      label: "Tau hit a snag",
    });
    expect(getGamesStatus({ ...base, isStalled: true })).toMatchObject({
      tone: "attention",
      label: "Build may be stuck",
    });
    expect(getGamesStatus({ ...base, status: "cancelled" })).toMatchObject({
      tone: "attention",
      label: "Build stopped",
    });
  });

  test("a build that ran out of credits is not reported as done", () => {
    expect(
      getGamesStatus({
        ...base,
        status: "done",
        hasPreview: true,
        interruptedForCredits: true,
        availableCredits: 0,
      }),
    ).toMatchObject({
      tone: "attention",
      label: "Build paused: out of credits",
    });
  });
});

describe("game embed url", () => {
  test("names the app origin, never the project page", () => {
    const url = new URL(gameEmbedUrl(GAMES[0]!, "https://app.tauai.pro"));
    expect(url.origin).toBe("https://html5.gamedistribution.com");
    expect(url.pathname).toBe(`/${GAMES[0]!.id}/`);
    expect(url.searchParams.get("gd_sdk_referrer_url")).toBe(
      "https://app.tauai.pro/",
    );
    expect(url.searchParams.get("gdpr-targeting")).toBe("0");
  });

  test("every game has a distinct id and its own thumbnail", () => {
    expect(new Set(GAMES.map((game) => game.id)).size).toBe(GAMES.length);
    for (const game of GAMES) {
      expect(game.thumbnail.startsWith(game.id)).toBe(true);
    }
  });
});
