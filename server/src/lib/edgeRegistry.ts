/**
 * What the edge router knows about a published site, kept in step with the
 * database.
 *
 * The router (`edge/`) never calls tau. It reads one routing record per
 * hostname from Cloudflare KV, and this module is the only thing that writes
 * them: after every change to what a site shows (publish, rollback, take
 * offline, suspend, a plan change that adds or removes the badge, deleting the
 * project) and from an hourly reconciler that repairs anything a failed push
 * left behind. The database row is the source of truth; KV is a cache of it
 * (doc/PUBLISHING.md C4, C9).
 *
 * With the Cloudflare settings unset every function here does nothing, so a
 * laptop behaves exactly as before.
 */
import { createHash } from "node:crypto";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/log";
import { DeploymentStatus } from "@/generated/prisma/enums";
import { showsBadge } from "@/lib/badge";

const { log } = createLogger("edge");

/** What the router reads at `host:{hostname}`. Keep in step with `RoutingRecord` in `edge/src/serve.ts`. */
export interface RoutingRecord {
  projectId: string;
  /** The label under the sites domain. */
  slug: string;
  /** `tau/sites/{userId}/{projectId}/{deploymentId}`; empty while only suspended. */
  prefix: string;
  showBadge: boolean;
  suspended: boolean;
}

export const KEY_PREFIX = "host:";

export function recordKey(slug: string, domain: string): string {
  return `${KEY_PREFIX}${slug}.${domain}`;
}

/** Stable text for a record, so two equal records always compare and hash alike. */
export function recordJson(record: RoutingRecord): string {
  return JSON.stringify({
    projectId: record.projectId,
    slug: record.slug,
    prefix: record.prefix,
    showBadge: record.showBadge,
    suspended: record.suspended,
  });
}

export function recordHash(record: RoutingRecord): string {
  return createHash("sha256").update(recordJson(record)).digest("hex").slice(0, 16);
}

/** What a project looks like to the router. Pure. */
export interface SiteState {
  id: string;
  slug: string | null;
  siteSuspendedAt: Date | null;
  /** The live deployment's prefix, when one is live and its files are intact. */
  livePrefix: string | null;
  plan: "FREE" | "PRO" | null;
}

/**
 * The record a site should have, or null when nothing is served there.
 *
 * Suspended wins over live: the router answers 403 and reads no files. A site
 * that is neither live nor suspended has no record at all, which the router
 * reads as "nothing published here".
 */
export function recordFor(site: SiteState): RoutingRecord | null {
  if (!site.slug) return null;
  if (!site.siteSuspendedAt && !site.livePrefix) return null;
  return {
    projectId: site.id,
    slug: site.slug,
    prefix: site.livePrefix ?? "",
    showBadge: showsBadge(site.plan ?? undefined),
    suspended: site.siteSuspendedAt !== null,
  };
}

// ── Cloudflare KV ────────────────────────────────────────────────────────────

export interface KvEntry {
  name: string;
  /** Hash of the record, kept as the key's metadata so a listing says what is stored without reading it. */
  hash: string | null;
}

export interface KvClient {
  list(prefix: string): Promise<KvEntry[]>;
  put(entries: { key: string; value: string; hash: string }[]): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

/** The three settings that switch the registry on, with the sites domain. */
export interface EdgeConfig {
  accountId: string;
  namespaceId: string;
  token: string;
  domain: string;
}

export function edgeConfig(): EdgeConfig | null {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const namespaceId = env.CLOUDFLARE_KV_NAMESPACE_ID;
  const token = env.CLOUDFLARE_API_TOKEN;
  const domain = env.SITES_DOMAIN;
  return accountId && namespaceId && token && domain
    ? { accountId, namespaceId, token, domain }
    : null;
}

const API = "https://api.cloudflare.com/client/v4";

class CloudflareError extends Error {}

/** Cloudflare's KV REST API, with the fetch it uses passed in so tests can see every request. */
export function cloudflareKv(config: EdgeConfig, fetcher: typeof fetch = fetch): KvClient {
  const base = `${API}/accounts/${config.accountId}/storage/kv/namespaces/${config.namespaceId}`;
  const headers = { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" };

  async function call(method: string, url: string, body?: unknown) {
    const res = await fetcher(url, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => null)) as {
      success?: boolean;
      errors?: { message?: string }[];
      result?: unknown;
      result_info?: { cursor?: string };
    } | null;
    if (!res.ok || json?.success === false) {
      throw new CloudflareError(
        `Cloudflare KV ${method} answered ${res.status}: ${json?.errors?.[0]?.message ?? "no reason given"}`,
      );
    }
    return json;
  }

  return {
    async list(prefix) {
      const out: KvEntry[] = [];
      let cursor: string | undefined;
      do {
        const query = new URLSearchParams({ prefix, limit: "1000", ...(cursor ? { cursor } : {}) });
        const json = await call("GET", `${base}/keys?${query}`);
        for (const k of (json?.result ?? []) as { name: string; metadata?: { h?: string } }[]) {
          out.push({ name: k.name, hash: k.metadata?.h ?? null });
        }
        cursor = json?.result_info?.cursor || undefined;
      } while (cursor);
      return out;
    },

    async put(entries) {
      if (entries.length === 0) return;
      // The bulk endpoint is the one that takes metadata, and it takes up to 10,000.
      for (let i = 0; i < entries.length; i += 1000) {
        await call(
          "PUT",
          `${base}/bulk`,
          entries.slice(i, i + 1000).map((e) => ({ key: e.key, value: e.value, metadata: { h: e.hash } })),
        );
      }
    },

    async remove(keys) {
      for (let i = 0; i < keys.length; i += 1000) {
        await call("POST", `${base}/bulk/delete`, keys.slice(i, i + 1000));
      }
    },
  };
}

// ── Reading the database ─────────────────────────────────────────────────────

const SITE_SELECT = {
  id: true,
  slug: true,
  siteSuspendedAt: true,
  liveDeploymentId: true,
  user: { select: { billing: { select: { plan: true } } } },
} as const;

type SiteRow = {
  id: string;
  slug: string | null;
  siteSuspendedAt: Date | null;
  liveDeploymentId: string | null;
  user: { billing: { plan: "FREE" | "PRO" } | null };
};

/** Project rows become site states; a live deployment counts only while it is READY and has its prefix. */
async function statesOf(rows: SiteRow[]): Promise<SiteState[]> {
  const liveIds = rows.map((r) => r.liveDeploymentId).filter((id): id is string => !!id);
  const deployments = liveIds.length
    ? await prisma.deployment.findMany({
        where: { id: { in: liveIds }, status: DeploymentStatus.READY },
        select: { id: true, storagePrefix: true },
      })
    : [];
  const prefixById = new Map(deployments.map((d) => [d.id, d.storagePrefix]));

  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    siteSuspendedAt: r.siteSuspendedAt,
    livePrefix: (r.liveDeploymentId && prefixById.get(r.liveDeploymentId)) || null,
    plan: r.user.billing?.plan ?? null,
  }));
}

// ── Pushing ──────────────────────────────────────────────────────────────────

let overrideClient: KvClient | null = null;
/** Tests hand in their own client. */
export function setKvClientForTests(client: KvClient | null): void {
  overrideClient = client;
}

function clientAndDomain(): { kv: KvClient; domain: string } | null {
  const config = edgeConfig();
  if (overrideClient) return { kv: overrideClient, domain: config?.domain ?? env.SITES_DOMAIN ?? "bytauai.pro" };
  return config ? { kv: cloudflareKv(config), domain: config.domain } : null;
}

/** Write or remove the routing record for these projects. Throws on a Cloudflare failure. */
async function syncRows(rows: SiteRow[]): Promise<void> {
  const target = clientAndDomain();
  if (!target) return;
  const puts: { key: string; value: string; hash: string }[] = [];
  const removes: string[] = [];

  for (const state of await statesOf(rows)) {
    if (!state.slug) continue;
    const key = recordKey(state.slug, target.domain);
    const record = recordFor(state);
    if (record) puts.push({ key, value: recordJson(record), hash: recordHash(record) });
    else removes.push(key);
  }
  await target.kv.put(puts);
  await target.kv.remove(removes);
}

/**
 * Bring one project's record in line with the database.
 *
 * Never throws: a failed push is logged and left for the hourly reconciler, so
 * a Cloudflare outage cannot fail a publish or a rollback that already
 * happened. Call it after the database change and after `invalidateSiteLookup`.
 */
export async function syncProject(projectId: string): Promise<void> {
  if (!clientAndDomain()) return;
  try {
    const row = await prisma.project.findUnique({ where: { id: projectId }, select: SITE_SELECT });
    if (row) await syncRows([row as SiteRow]);
  } catch (err) {
    log.warn("edge.sync_failed", { projectId, error: String(err).slice(0, 300) });
  }
}

/** Every project of a user: a plan change adds or removes the badge on all of them. */
export async function syncUser(userId: string): Promise<void> {
  if (!clientAndDomain()) return;
  try {
    const rows = await prisma.project.findMany({
      where: { userId, slug: { not: null } },
      select: SITE_SELECT,
    });
    await syncRows(rows as SiteRow[]);
  } catch (err) {
    log.warn("edge.sync_user_failed", { userId, error: String(err).slice(0, 300) });
  }
}

/** Remove the record for an address whose project has been deleted. */
export async function removeSite(slug: string | null): Promise<void> {
  const target = clientAndDomain();
  if (!target || !slug) return;
  try {
    await target.kv.remove([recordKey(slug, target.domain)]);
  } catch (err) {
    log.warn("edge.remove_failed", { slug, error: String(err).slice(0, 300) });
  }
}

export interface ReconcileResult {
  /** Records the database says should exist. */
  expected: number;
  written: number;
  removed: number;
}

/**
 * Compare every record in KV with what the database says, and fix the
 * difference in both directions: a missing or different record is written, a
 * record nothing should have is removed.
 *
 * Costs one KV list and one write per difference, and no reads: each record's
 * hash is stored as its key's metadata, so the listing alone says what is there.
 * Returns null where the registry is off.
 */
export async function reconcileEdge(): Promise<ReconcileResult | null> {
  const target = clientAndDomain();
  if (!target) return null;

  const rows = await prisma.project.findMany({
    where: { slug: { not: null }, OR: [{ liveDeploymentId: { not: null } }, { siteSuspendedAt: { not: null } }] },
    select: SITE_SELECT,
  });
  const wanted = new Map<string, { value: string; hash: string }>();
  for (const state of await statesOf(rows as SiteRow[])) {
    const record = recordFor(state);
    if (record && state.slug) {
      wanted.set(recordKey(state.slug, target.domain), { value: recordJson(record), hash: recordHash(record) });
    }
  }

  const present = new Map((await target.kv.list(KEY_PREFIX)).map((e) => [e.name, e.hash]));
  const puts = [...wanted]
    .filter(([key, w]) => present.get(key) !== w.hash)
    .map(([key, w]) => ({ key, value: w.value, hash: w.hash }));
  const removes = [...present.keys()].filter((key) => !wanted.has(key));

  await target.kv.put(puts);
  await target.kv.remove(removes);
  return { expected: wanted.size, written: puts.length, removed: removes.length };
}

/** Hourly entry point, beside `runDeploySweep`. */
export async function runEdgeReconcile(): Promise<void> {
  try {
    const result = await reconcileEdge();
    if (result && (result.written > 0 || result.removed > 0)) log.info("edge.reconciled", { ...result });
  } catch (err) {
    log.warn("edge.reconcile_failed", { error: String(err).slice(0, 300) });
  }
}
