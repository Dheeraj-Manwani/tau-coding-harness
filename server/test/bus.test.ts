import { describe, expect, test } from "bun:test";
import { bus } from "../src/lib/bus";

describe("job bus recovery", () => {
  test("signals a missing replay window even though the ring is non-empty", () => {
    const jobId = crypto.randomUUID();
    for (let index = 0; index <= 10_000; index++) {
      bus.emit(jobId, { type: "thinking", index });
    }
    const received: string[] = [];
    const unsubscribe = bus.subscribe(jobId, -1, (event) => received.push(event.type));
    unsubscribe();
    expect(received).toEqual(["resync"]);
  });

  test("cancel releases a job waiting for a user answer", async () => {
    const jobId = crypto.randomUUID();
    const waiting = bus.waitForUserResponse(jobId, 60_000);
    bus.requestCancel(jobId);
    expect(await waiting).toBeNull();
  });

  test("a late answer cannot be consumed by the next question", async () => {
    const jobId = crypto.randomUUID();
    bus.registerQuestion(jobId, "first");
    bus.clearQuestion(jobId, "first");
    bus.registerQuestion(jobId, "second");
    bus.pushUserResponse(jobId, "first", "stale answer");
    bus.pushUserResponse(jobId, "second", "current answer");
    expect(await bus.waitForUserResponse(jobId, 1000)).toBe("current answer");
    bus.clearQuestion(jobId, "second");
  });
});
