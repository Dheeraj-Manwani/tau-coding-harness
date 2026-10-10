/**
 * Cloud resources that belong to a project that is gone (doc/PUBLISHING.md C9).
 *
 * Every resource is recorded before it is created, and deleting a project removes
 * its AWS resources and schedules its database first. Two things can still leave
 * one behind: a publish that was running when its project was deleted and made
 * its function afterwards, and a database whose removal was never scheduled. A
 * resource row with no project is the signal for both; the row, not a listing of
 * the cloud account, is what is trusted, so nothing that tau did not make can be
 * touched. Runs hourly beside the other sweeps.
 */
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { removeBackend } from "@/lib/lambdaApps";
import { ResourceKind } from "@/generated/prisma/enums";

const DAY_MS = 24 * 60 * 60 * 1000;
const FUNCTION_PREFIX = "tau-app-";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The project a function or role name was made for, or null when it is not one of tau's. */
export function projectIdOfResourceName(providerId: string): string | null {
  if (!providerId.startsWith(FUNCTION_PREFIX)) return null;
  const id = providerId.slice(FUNCTION_PREFIX.length);
  return UUID.test(id) ? id : null;
}

export interface ReconcileResult {
  backendsRemoved: number;
  databasesScheduled: number;
  errors: string[];
}

export async function reconcileResources(): Promise<ReconcileResult> {
  const result: ReconcileResult = { backendsRemoved: 0, databasesScheduled: 0, errors: [] };

  // Settle first: a publish still running for a project deleted a moment ago may yet create these.
  const settled = new Date(Date.now() - 60 * 60 * 1000);
  const strayBackends = await prisma.projectResource.findMany({
    where: { projectId: null, deletedAt: null, kind: { in: [ResourceKind.LAMBDA_FUNCTION, ResourceKind.IAM_ROLE] }, createdAt: { lt: settled } },
    take: 50,
  });
  const done = new Set<string>();
  for (const row of strayBackends) {
    const projectId = projectIdOfResourceName(row.providerId);
    if (!projectId || done.has(projectId)) continue;
    done.add(projectId);
    try {
      await removeBackend(projectId);
      result.backendsRemoved += 1;
    } catch (err) {
      result.errors.push(`${row.providerId}: ${String(err).slice(0, 200)}`);
    }
  }

  const unscheduled = await prisma.projectResource.updateMany({
    where: { projectId: null, deletedAt: null, deleteAfter: null, kind: ResourceKind.NEON_PROJECT },
    data: { deleteAfter: new Date(Date.now() + env.DATABASE_DELETE_DELAY_DAYS * DAY_MS) },
  });
  result.databasesScheduled = unscheduled.count;
  return result;
}
