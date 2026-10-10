/**
 * Tau Cloud Storage as the operators see it (doc/TAU_CLOUD_STORAGE.md S4): what
 * is stored, by whom, and the controls for stopping one project's storage.
 *
 * Every action takes the acting admin's id and writes it to the log with the
 * project, so "who suspended this and why" has an answer.
 */
import { prisma } from "@/lib/prisma";
import { Errors, AppError } from "../lib/errors";
import { log } from "../lib/log";
import { limitsFor, planFor } from "@/lib/storageQuota";
import { storageConfigured } from "@/lib/storageBucket";
import * as storage from "./storage.service";
import { StorageError } from "../lib/storageErrors";
import type { StorageSignals } from "../lib/anomalies";

const HOUR_MS = 3_600_000;
/** The share of an owner's allowance at which they are listed as near it. */
export const NEAR_ALLOWANCE = 0.8;

const num = (v: bigint | null | undefined) => Number(v ?? 0n);

/** What the alert rules read. Cheap: two grouped queries over indexed columns. */
export async function storageSignals(): Promise<StorageSignals> {
  const [busiest, total] = await Promise.all([
    prisma.storageObject.groupBy({
      by: ["projectId"],
      where: { createdAt: { gte: new Date(Date.now() - HOUR_MS) } },
      _count: { _all: true },
      orderBy: { _count: { projectId: "desc" } },
      take: 1,
    }),
    prisma.storageObject.aggregate({
      where: { status: { in: ["PENDING", "READY"] } },
      _sum: { sizeBytes: true },
    }),
  ]);
  return {
    busiestProject: busiest[0] ? { projectId: busiest[0].projectId, uploads: busiest[0]._count._all } : null,
    totalBytes: num(total._sum.sizeBytes),
  };
}

export async function overview() {
  const live = { status: { in: ["PENDING", "READY"] as ("PENDING" | "READY")[] } };
  const [totals, readyCount, byProject, byOwner, hourly, signals] = await Promise.all([
    prisma.storageObject.aggregate({ where: live, _sum: { sizeBytes: true } }),
    prisma.storageObject.count({ where: { status: "READY" } }),
    prisma.storageObject.groupBy({
      by: ["projectId"],
      where: live,
      _sum: { sizeBytes: true },
      _count: { _all: true },
      orderBy: { _sum: { sizeBytes: "desc" } },
    }),
    prisma.storageObject.groupBy({
      by: ["userId"],
      where: live,
      _sum: { sizeBytes: true },
      _count: { _all: true },
      orderBy: { _sum: { sizeBytes: "desc" } },
    }),
    prisma.$queryRaw<{ hour: Date; uploads: number }[]>`
      select date_trunc('hour', "createdAt") as hour, count(*)::int as uploads
      from "StorageObject"
      where "createdAt" >= now() - interval '24 hours'
      group by 1 order by 1`,
    storageSignals(),
  ]);

  const topProjects = byProject.slice(0, 20);
  const projects = await prisma.project.findMany({
    where: { id: { in: topProjects.map((p) => p.projectId) } },
    select: { id: true, name: true, userId: true, storageSuspendedAt: true },
  });
  const projectById = new Map(projects.map((p) => [p.id, p]));

  const owners = await Promise.all(
    byOwner.map(async (o) => {
      const { quotaBytes } = limitsFor(await planFor(o.userId));
      const usedBytes = num(o._sum.sizeBytes);
      return { userId: o.userId, usedBytes, files: o._count._all, quotaBytes, ratio: quotaBytes ? usedBytes / quotaBytes : 0 };
    }),
  );

  return {
    configured: storageConfigured(),
    totals: { usedBytes: num(totals._sum.sizeBytes), files: readyCount, projects: byProject.length, owners: byOwner.length },
    busiestProject: signals.busiestProject,
    uploadsPerHour: hourly.map((h) => ({ hour: h.hour, uploads: h.uploads })),
    topProjects: topProjects.map((p) => ({
      projectId: p.projectId,
      name: projectById.get(p.projectId)?.name ?? null,
      userId: projectById.get(p.projectId)?.userId ?? null,
      suspended: Boolean(projectById.get(p.projectId)?.storageSuspendedAt),
      usedBytes: num(p._sum.sizeBytes),
      files: p._count._all,
    })),
    topOwners: owners.slice(0, 20),
    nearAllowance: owners.filter((o) => o.ratio >= NEAR_ALLOWANCE).sort((a, b) => b.ratio - a.ratio),
  };
}

async function project(projectId: string) {
  const p = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, userId: true, storageEnabled: true, storageSuspendedAt: true },
  });
  if (!p) throw Errors.notFound("Project not found");
  return p;
}

/** Stop uploads and download addresses for one project. Files are kept. */
export async function suspendStorage(projectId: string, adminId: string, reason: string) {
  const p = await project(projectId);
  const updated = await prisma.project.update({
    where: { id: projectId },
    data: { storageSuspendedAt: p.storageSuspendedAt ?? new Date() },
    select: { storageSuspendedAt: true },
  });
  log.warn("admin.storage.suspend", { projectId, adminId, reason });
  return updated;
}

export async function resumeStorage(projectId: string, adminId: string) {
  await project(projectId);
  const updated = await prisma.project.update({
    where: { id: projectId },
    data: { storageSuspendedAt: null },
    select: { storageSuspendedAt: true },
  });
  log.warn("admin.storage.resume", { projectId, adminId });
  return updated;
}

type Env = "PREVIEW" | "LIVE";

async function asAdminError<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof StorageError) throw new AppError(err.message, err.status);
    throw err;
  }
}

/** Any project's files, including while suspended. */
export async function listFiles(projectId: string, env: Env, q: { prefix?: string; cursor?: string; limit?: number }) {
  const p = await project(projectId);
  return asAdminError(() => storage.listFiles({ projectId, userId: p.userId, env }, q));
}

/** Takedown of one file. Needs the bucket; refuses rather than report a delete that did not happen. */
export async function deleteFile(projectId: string, env: Env, key: string, adminId: string, reason: string) {
  if (!storageConfigured()) throw new AppError("File storage is not available on this server.", 503);
  const p = await project(projectId);
  const result = await asAdminError(() => storage.deleteFiles({ projectId, userId: p.userId, env }, { keys: [key] }));
  log.warn("admin.storage.delete_file", { projectId, env, key, adminId, reason, deleted: result.deleted });
  return result;
}
