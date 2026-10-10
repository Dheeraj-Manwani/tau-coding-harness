import { expect, test } from "bun:test";
import { quotaProblem, type QuotaInput } from "@/lib/deployQuota";

const base: QuotaInput = {
  limits: { publishesPerAppPerDay: 5, backendApps: 1 },
  publishesToday: 0,
  needsBackend: true,
  otherLiveBackends: 0,
  alreadyLiveBackend: false,
};

test("a publish within both limits is allowed", () => {
  expect(quotaProblem(base)).toBeNull();
  expect(quotaProblem({ ...base, publishesToday: 4 })).toBeNull();
});

test("the daily publish limit refuses the next one with the count and the limit", () => {
  const problem = quotaProblem({ ...base, publishesToday: 5 });
  expect(problem).toContain("5 times");
  expect(problem).toContain("(5)");
});

test("a second live backend app is refused on a one-app plan", () => {
  expect(quotaProblem({ ...base, otherLiveBackends: 1 })).toContain("one app with a server");
});

test("an app that already has its backend live takes no new slot", () => {
  expect(quotaProblem({ ...base, otherLiveBackends: 1, alreadyLiveBackend: true })).toBeNull();
});

test("a static publish is never held back by the backend limit", () => {
  expect(quotaProblem({ ...base, needsBackend: false, otherLiveBackends: 3 })).toBeNull();
});

test("a larger plan names its own number", () => {
  const limits = { publishesPerAppPerDay: 25, backendApps: 10 };
  expect(quotaProblem({ ...base, limits, otherLiveBackends: 10 })).toContain("10 apps");
  expect(quotaProblem({ ...base, limits, otherLiveBackends: 9 })).toBeNull();
});
