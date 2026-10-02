/**
 * A tiny TTL cache with in-flight de-duplication, for the ops console.
 *
 * The console's contract with the server is "reload is the refresh button" —
 * which only stays cheap if reloads are cheap. So every expensive admin read
 * goes through here:
 *
 *   - within `ttlMs` a reload is served from memory;
 *   - concurrent callers (two tabs, a double click) share one computation;
 *   - `fresh` bypasses the TTL, but no more often than `minFreshMs`, so a
 *     held-down refresh key cannot turn into a query storm.
 *
 * Rejections are never cached: the next caller simply tries again.
 */

interface Entry {
  value: unknown;
  at: number;
  ttlMs: number;
}

const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<Entry>>();

export interface MemoOptions<T> {
  ttlMs: number;
  /** Bypass the TTL (still subject to `minFreshMs`). */
  fresh?: boolean;
  /** Floor between forced recomputations. Default 10 s. */
  minFreshMs?: number;
  /** Per-value TTL override — e.g. retry a failed provider check sooner. */
  ttlFor?: (value: T) => number;
  now?: () => number;
}

export interface Memoized<T> {
  value: T;
  /** When `value` was computed (epoch ms). */
  at: number;
}

export async function memo<T>(
  key: string,
  compute: () => Promise<T>,
  opts: MemoOptions<T>,
): Promise<Memoized<T>> {
  const now = opts.now ?? Date.now;
  const cached = store.get(key);
  if (cached) {
    const age = now() - cached.at;
    const forced = opts.fresh && age >= (opts.minFreshMs ?? 10_000);
    if (age < cached.ttlMs && !forced) {
      return { value: cached.value as T, at: cached.at };
    }
  }

  const pending = inflight.get(key);
  if (pending) {
    const entry = await pending;
    return { value: entry.value as T, at: entry.at };
  }

  const run = (async (): Promise<Entry> => {
    const value = await compute();
    const entry: Entry = {
      value,
      at: now(),
      ttlMs: opts.ttlFor ? opts.ttlFor(value) : opts.ttlMs,
    };
    store.set(key, entry);
    return entry;
  })();

  inflight.set(key, run);
  try {
    const entry = await run;
    return { value: entry.value as T, at: entry.at };
  } finally {
    inflight.delete(key);
  }
}

/** Forget everything. For tests. */
export function clearMemo(): void {
  store.clear();
  inflight.clear();
}
