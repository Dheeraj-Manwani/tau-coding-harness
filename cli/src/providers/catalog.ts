/**
 * models.dev catalog loader.
 *
 * The provider modules ship a small static `models` seed for bootstrap/offline
 * use, but the live catalog comes from https://models.dev/api.json. This module
 * fetches that document, caches it on disk with a TTL, and maps it into our
 * `ModelInfo` shape. Network or parse failures fall back to the (possibly stale)
 * disk cache, and finally to the static seeds — the catalog is never empty.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { catalogCachePath } from "../config/paths.ts";
import type { FetchLike, ModelInfo } from "./types.ts";

const API_URL = "https://models.dev/api.json";

/** Refresh the on-disk catalog at most once a day. */
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/** Raised when the model catalog can't be loaded (offline, no cached copy). */
export class CatalogError extends Error {}

// ---------------------------------------------------------------------------
// Raw shape of the bits of models.dev we consume (it carries much more).
// ---------------------------------------------------------------------------

interface RawModel {
  id: string;
  name: string;
  tool_call?: boolean;
  release_date?: string;
  limit?: { context?: number; output?: number };
}

interface RawProvider {
  id: string;
  name: string;
  models: Record<string, RawModel>;
}

export type RawCatalog = Record<string, RawProvider>;

interface CacheEnvelope {
  fetchedAt: number;
  data: RawCatalog;
}

export interface CatalogOptions {
  /** Override fetch (tests). Defaults to `globalThis.fetch`. */
  fetch?: FetchLike;
  /** Cache freshness window in ms. */
  ttlMs?: number;
  /** Ignore a fresh cache and re-fetch. */
  force?: boolean;
}

/**
 * Return the raw models.dev catalog, preferring a fresh disk cache, then the
 * network, then a stale cache. Returns `undefined` only when there is no cache
 * and the network is unreachable — callers then keep their static seeds.
 */
export async function fetchRawCatalog(
  opts: CatalogOptions = {},
): Promise<RawCatalog | undefined> {
  const ttl = opts.ttlMs ?? DEFAULT_TTL_MS;
  const cached = await readCache();

  if (!opts.force && cached && Date.now() - cached.fetchedAt < ttl) {
    return cached.data;
  }

  try {
    const doFetch = opts.fetch ?? ((i: any, init?: any) => globalThis.fetch(i, init));
    const res = await doFetch(API_URL, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`models.dev responded ${res.status}`);
    const data = (await res.json()) as RawCatalog;
    await writeCache({ fetchedAt: Date.now(), data });
    return data;
  } catch {
    // Offline or transient failure: a stale cache still beats nothing.
    return cached?.data;
  }
}

/**
 * Project the catalog for one provider into our `ModelInfo[]`, keeping only
 * tool-calling models (the agent always sends tools), newest first. The newest
 * model is flagged as the default.
 */
export function modelsForProvider(
  raw: RawCatalog,
  providerId: string,
): ModelInfo[] {
  const provider = raw[providerId];
  if (!provider?.models) return [];

  const models: ModelInfo[] = Object.values(provider.models)
    .filter((m) => m.tool_call)
    .sort((a, b) => (b.release_date ?? "").localeCompare(a.release_date ?? ""))
    .map((m) => ({ id: m.id, name: m.name, context: m.limit?.context }));

  // Newest release is the default; flag it so selection menus can mark it.
  if (models[0]) models[0].recommended = true;

  return models;
}

// ---------------------------------------------------------------------------
// Disk cache (best effort — any IO error degrades to "no cache").
// ---------------------------------------------------------------------------

async function readCache(): Promise<CacheEnvelope | undefined> {
  try {
    const raw = await readFile(catalogCachePath(), "utf8");
    const parsed = JSON.parse(raw) as CacheEnvelope;
    if (parsed && typeof parsed.fetchedAt === "number" && parsed.data) {
      return parsed;
    }
  } catch {
    /* no cache yet, or unreadable */
  }
  return undefined;
}

async function writeCache(envelope: CacheEnvelope): Promise<void> {
  try {
    const path = catalogCachePath();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(envelope), "utf8");
  } catch {
    /* caching is an optimization; ignore failures */
  }
}
