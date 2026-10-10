import { DeploymentStatus } from "@/generated/prisma/enums";

/**
 * Every status a deployment has while its publish is still running.
 *
 * One list, because three places need it and a status added to the enum but
 * missing from one of them is a publish that looks finished while it runs (the
 * panel's button) or a deployment nothing ever fails when its job is reaped
 * (the Publish button disabled for good). The full-stack steps are
 * VALIDATING, PROVISIONING and VERIFYING; a static publish never has them.
 */
export const IN_FLIGHT_DEPLOYMENT_STATUSES: DeploymentStatus[] = [
  DeploymentStatus.QUEUED,
  DeploymentStatus.VALIDATING,
  DeploymentStatus.BUILDING,
  DeploymentStatus.PROVISIONING,
  DeploymentStatus.UPLOADING,
  DeploymentStatus.VERIFYING,
];

export function isInFlight(status: DeploymentStatus): boolean {
  return IN_FLIGHT_DEPLOYMENT_STATUSES.includes(status);
}
