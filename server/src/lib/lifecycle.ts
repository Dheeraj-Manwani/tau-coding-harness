/**
 * Process lifecycle flag, shared by the health check and the job runner.
 *
 * Set once on SIGTERM. From then on `/healthz` answers 503 so the proxy and any
 * uptime monitor see the instance leaving, and the runner stops starting jobs
 * while the ones already running are given time to finish (see src/index.ts).
 */
let draining = false;

export function isDraining(): boolean {
  return draining;
}

export function startDraining(): void {
  draining = true;
}
