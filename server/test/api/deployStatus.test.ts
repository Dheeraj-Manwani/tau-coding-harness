import { expect, test } from "bun:test";
import { DeploymentStatus } from "@/generated/prisma/enums";
import { IN_FLIGHT_DEPLOYMENT_STATUSES, isInFlight } from "@/lib/deployStatus";

// A new status has to be decided on: still running, or finished. Adding one to
// the enum without doing so would make a publish look finished while it runs.
const FINISHED = [DeploymentStatus.READY, DeploymentStatus.FAILED, DeploymentStatus.SUPERSEDED];

test("every deployment status is either in flight or finished, never both", () => {
  for (const status of Object.values(DeploymentStatus)) {
    const inFlight = isInFlight(status);
    const finished = (FINISHED as string[]).includes(status);
    expect(inFlight !== finished).toBe(true);
  }
  expect(IN_FLIGHT_DEPLOYMENT_STATUSES.length + FINISHED.length).toBe(Object.values(DeploymentStatus).length);
});
