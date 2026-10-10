/**
 * A Postgres database per published app, on Neon (doc/PUBLISHING.md D2, Phase 5).
 *
 * One Neon project per app, named `tau-app-{projectId}`. The connection string
 * (Neon's pooled one) is stored encrypted on a `ProjectResource` row and goes
 * only into the function's `DATABASE_URL`: no endpoint returns it. As with the
 * Lambda resources, the row is written *before* the project is created, so a
 * publish that dies half way leaves something the next one (or the sweep) finds,
 * and a project that already exists at Neon under the app's name is adopted
 * rather than created twice.
 *
 * Preview data is never copied here, and a publish never replaces this database.
 */
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { decryptKey, encryptKey } from "@/lib/apiKeys";
import { ResourceKind } from "@/generated/prisma/enums";
import { log } from "@/api/lib/log";

const API = "https://console.neon.tech/api/v2";
const DAY_MS = 24 * 60 * 60 * 1000;

export const databaseName = (projectId: string) => `tau-app-${projectId}`;
const pendingId = (projectId: string) => `pending:${projectId}`;

export interface NeonApi {
  createProject(name: string): Promise<{ id: string; region: string }>;
  /** The pooled connection string for the project's default database and role. */
  pooledUri(neonProjectId: string): Promise<string>;
  createBranch(neonProjectId: string, name: string): Promise<{ id: string }>;
  deleteProject(neonProjectId: string): Promise<void>;
  /** A project of this exact name, or null. */
  findProject(name: string): Promise<{ id: string; region: string } | null>;
}

export class NeonError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "NeonError";
  }
}

/** Neon answered "not found": what delete treats as already done. */
export const isGone = (err: unknown): boolean => err instanceof NeonError && err.status === 404;

// ── Neon's HTTP API ──────────────────────────────────────────────────────────

export function neonApi(apiKey: string, regionId: string, orgId?: string): NeonApi {
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json", "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    if (!res.ok) {
      let message = text.slice(0, 200);
      try {
        message = (JSON.parse(text) as { message?: string }).message ?? message;
      } catch {
        // not JSON: the slice above will do
      }
      throw new NeonError(message || `Neon answered ${res.status}`, res.status);
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  return {
    async createProject(name) {
      const res = await call<{ project: { id: string; region_id: string } }>("POST", "/projects", {
        project: { name, region_id: regionId, ...(orgId ? { org_id: orgId } : {}) },
      });
      return { id: res.project.id, region: res.project.region_id };
    },
    async pooledUri(neonProjectId) {
      const res = await call<{ uri: string }>("GET", `/projects/${neonProjectId}/connection_uri?pooled=true&database_name=neondb&role_name=neondb_owner`);
      return res.uri;
    },
    async createBranch(neonProjectId, name) {
      const res = await call<{ branch: { id: string } }>("POST", `/projects/${neonProjectId}/branches`, { branch: { name } });
      return { id: res.branch.id };
    },
    async deleteProject(neonProjectId) {
      await call("DELETE", `/projects/${neonProjectId}`);
    },
    async findProject(name) {
      const res = await call<{ projects: { id: string; name: string; region_id: string }[] }>(
        "GET",
        `/projects?search=${encodeURIComponent(name)}&limit=10${orgId ? `&org_id=${orgId}` : ""}`,
      );
      const hit = res.projects.find((p) => p.name === name);
      return hit ? { id: hit.id, region: hit.region_id } : null;
    },
  };
}

// ── Seam for tests ───────────────────────────────────────────────────────────

let override: NeonApi | null = null;

/** Tests hand in a stand-in for Neon. Pass null to put the real one back. */
export function setNeonApiForTests(api: NeonApi | null): void {
  override = api;
}

function api(): NeonApi | null {
  if (override) return override;
  return env.NEON_API_KEY ? neonApi(env.NEON_API_KEY, env.NEON_REGION_ID, env.NEON_ORG_ID) : null;
}

/** Whether apps with a database can be published at all on this server. */
export function databaseHostingAvailable(): boolean {
  return override !== null || !!env.NEON_API_KEY;
}

// ── The flow ─────────────────────────────────────────────────────────────────

const need = (): NeonApi => {
  const have = api();
  if (!have) throw new Error("Database hosting is not configured.");
  return have;
};

/**
 * The app's connection string, creating its database the first time.
 *
 * Safe to call on every publish and safe to repeat after a failure at any step.
 */
export async function ensureDatabase(projectId: string): Promise<{ url: string; created: boolean }> {
  const neon = need();

  const live = await prisma.projectResource.findFirst({
    where: { projectId, kind: ResourceKind.NEON_PROJECT, deletedAt: null },
  });
  if (live?.secretCiphertext && !live.providerId.startsWith("pending:")) {
    return { url: decryptKey(live.secretCiphertext), created: false };
  }

  // Recorded before anything exists at Neon, under a placeholder id.
  await prisma.projectResource.upsert({
    where: { kind_providerId: { kind: ResourceKind.NEON_PROJECT, providerId: pendingId(projectId) } },
    create: { projectId, kind: ResourceKind.NEON_PROJECT, providerId: pendingId(projectId), region: env.NEON_REGION_ID },
    update: { deletedAt: null },
  });

  const adopted = await neon.findProject(databaseName(projectId));
  const project = adopted ?? (await neon.createProject(databaseName(projectId)));
  const url = await neon.pooledUri(project.id);

  await prisma.projectResource.update({
    where: { kind_providerId: { kind: ResourceKind.NEON_PROJECT, providerId: pendingId(projectId) } },
    data: { providerId: project.id, region: project.region, secretCiphertext: encryptKey(url) },
  });
  log.info("neon.database_ready", { projectId, adopted: !!adopted });
  return { url, created: !adopted };
}

/** The app's connection string if it has a database, without creating one. */
export async function getDatabaseUrl(projectId: string): Promise<string | null> {
  const row = await prisma.projectResource.findFirst({
    where: { projectId, kind: ResourceKind.NEON_PROJECT, deletedAt: null },
  });
  return row?.secretCiphertext && !row.providerId.startsWith("pending:") ? decryptKey(row.secretCiphertext) : null;
}

/** A restore point before a confirmed schema change. Returns Neon's branch id. */
export async function branchDatabase(projectId: string, label: string): Promise<string> {
  const neon = need();
  const row = await prisma.projectResource.findFirst({
    where: { projectId, kind: ResourceKind.NEON_PROJECT, deletedAt: null },
  });
  if (!row || row.providerId.startsWith("pending:")) throw new Error("This project has no database yet.");
  const branch = await neon.createBranch(row.providerId, label);
  log.info("neon.branch_created", { projectId, branchId: branch.id });
  return branch.id;
}

/**
 * Called when a project is deleted, just before its rows go: the database is
 * kept for {@link env.DATABASE_DELETE_DELAY_DAYS} more days, in case the delete
 * was a mistake. The row's `projectId` goes null with the project; this date is
 * what the sweep follows.
 */
export async function scheduleDatabaseRemoval(projectId: string): Promise<void> {
  await prisma.projectResource.updateMany({
    where: { projectId, kind: ResourceKind.NEON_PROJECT, deletedAt: null },
    data: { deleteAfter: new Date(Date.now() + env.DATABASE_DELETE_DELAY_DAYS * DAY_MS) },
  });
}

export interface DatabaseSweepResult {
  removed: number;
  adopted: number;
  errors: string[];
}

/**
 * Remove databases whose delay has passed, and tidy half-made ones: a
 * placeholder row older than an hour is either adopted (the project did get
 * created) or dropped (it did not).
 */
export async function sweepDatabases(): Promise<DatabaseSweepResult> {
  const result: DatabaseSweepResult = { removed: 0, adopted: 0, errors: [] };
  const neon = api();
  if (!neon) return result;

  const due = await prisma.projectResource.findMany({
    where: { kind: ResourceKind.NEON_PROJECT, deletedAt: null, deleteAfter: { lt: new Date() } },
    take: 50,
  });
  for (const row of due) {
    try {
      if (!row.providerId.startsWith("pending:")) {
        await neon.deleteProject(row.providerId).catch((err) => {
          if (!isGone(err)) throw err;
        });
      }
      await prisma.projectResource.update({ where: { id: row.id }, data: { deletedAt: new Date(), secretCiphertext: null } });
      result.removed += 1;
    } catch (err) {
      result.errors.push(`${row.providerId}: ${String(err)}`);
    }
  }

  const stale = await prisma.projectResource.findMany({
    where: { kind: ResourceKind.NEON_PROJECT, deletedAt: null, providerId: { startsWith: "pending:" }, createdAt: { lt: new Date(Date.now() - 60 * 60 * 1000) } },
    take: 50,
  });
  for (const row of stale) {
    try {
      const projectId = row.providerId.slice("pending:".length);
      const found = await neon.findProject(databaseName(projectId));
      if (found) {
        await prisma.projectResource.update({
          where: { id: row.id },
          data: { providerId: found.id, region: found.region, secretCiphertext: encryptKey(await neon.pooledUri(found.id)) },
        });
        result.adopted += 1;
      } else {
        await prisma.projectResource.update({ where: { id: row.id }, data: { deletedAt: new Date() } });
      }
    } catch (err) {
      result.errors.push(`${row.providerId}: ${String(err)}`);
    }
  }
  return result;
}
