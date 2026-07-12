import { EventEmitter } from "node:events";

/**
 * In-process replacement for every cross-service Redis interaction, used by the
 * economy (single-process) deployment. Standalone `master` still uses Redis;
 * this file is only reached through the economy forks of the transport modules
 * (the per-service `lib/bus.ts` shims) and the combined entrypoint.
 *
 * Roles covered (see doc/economy-deployment.md):
 *   1. job dispatch            — dispatch / onDispatch
 *   2. live event fan-out      — emit / subscribe
 *   3. event replay + count    — buffer behind emit/subscribe, length()
 *   4. cancellation            — requestCancel / onCancel / isCancelled
 *   6. user-response handoff    — pushUserResponse / waitForUserResponse
 *   7. plan-created flag (TTL)  — markPlan / hasPlan
 * (Role 5, the rate-limit store, becomes express-rate-limit's in-memory store
 *  and does not go through this bus.)
 */

export interface JobEvent {
  type: string;
  index: number;
  [k: string]: unknown;
}

export interface DispatchPayload {
  jobId: string;
  projectId: string;
  userId: string;
  prompt: string;
  effort: string;
}

interface JobBuffer {
  events: JobEvent[];
  lastTouched: number;
}

const RING_TTL_MS = 60 * 60 * 1000; // role 3: mirror Redis expire(events, 3600)
const RING_MAX = 10_000; // hard cap on buffered events per job
const PLAN_TTL_MS = 2 * 60 * 60 * 1000; // role 7: mirror plan key EX 2h
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

class InProcessBus {
  private readonly events = new EventEmitter(); // role 2
  private readonly buffers = new Map<string, JobBuffer>(); // role 3
  private readonly dispatches = new EventEmitter(); // role 1
  private readonly cancels = new EventEmitter(); // role 4
  private readonly cancelled = new Set<string>();
  private readonly waiters = new Map<string, Array<(v: string) => void>>(); // role 6
  private readonly pendingAnswers = new Map<string, string[]>(); // role 6
  private readonly plans = new Map<string, number>(); // role 7: jobId -> expiresAt

  constructor() {
    // Many concurrent SSE subscribers / jobs — disable the listener-leak warning.
    this.events.setMaxListeners(0);
    this.dispatches.setMaxListeners(0);
    this.cancels.setMaxListeners(0);
    const timer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    timer.unref?.();
  }

  // ── role 1: job dispatch ──────────────────────────────────────────────────
  dispatch(payload: DispatchPayload): void {
    this.dispatches.emit("job", payload);
  }

  onDispatch(handler: (p: DispatchPayload) => void): () => void {
    this.dispatches.on("job", handler);
    return () => void this.dispatches.off("job", handler);
  }

  // ── roles 2 + 3: live events + replay buffer ──────────────────────────────
  emit(jobId: string, event: JobEvent): void {
    let buf = this.buffers.get(jobId);
    if (!buf) {
      buf = { events: [], lastTouched: Date.now() };
      this.buffers.set(jobId, buf);
    }
    buf.events.push(event);
    buf.lastTouched = Date.now();
    if (buf.events.length > RING_MAX) {
      buf.events.splice(0, buf.events.length - RING_MAX);
    }
    this.events.emit(jobId, event);
  }

  /** Number of buffered events for a job (replaces `redis.llen`). */
  length(jobId: string): number {
    return this.buffers.get(jobId)?.events.length ?? 0;
  }

  /**
   * Replay buffered events with index > fromIndex, then attach a live listener.
   * Mirrors ws-gateway SocketManager.subscribe: an expired/empty buffer with a
   * prior client index (fromIndex >= 0) yields a synthetic `resync`.
   */
  subscribe(
    jobId: string,
    fromIndex: number,
    onEvent: (e: JobEvent) => void,
  ): () => void {
    const buf = this.buffers.get(jobId);
    if ((!buf || buf.events.length === 0) && fromIndex >= 0) {
      onEvent({ type: "resync", index: fromIndex });
    } else if (buf) {
      for (const e of buf.events) {
        if (e.index > fromIndex) onEvent(e);
      }
    }
    const listener = (e: JobEvent): void => onEvent(e);
    this.events.on(jobId, listener);
    return () => void this.events.off(jobId, listener);
  }

  // ── role 4: cancellation ──────────────────────────────────────────────────
  requestCancel(jobId: string): void {
    this.cancelled.add(jobId);
    this.cancels.emit(jobId);
  }

  isCancelled(jobId: string): boolean {
    return this.cancelled.has(jobId);
  }

  onCancel(jobId: string, cb: () => void): () => void {
    if (this.cancelled.has(jobId)) queueMicrotask(cb);
    const listener = (): void => cb();
    this.cancels.on(jobId, listener);
    return () => void this.cancels.off(jobId, listener);
  }

  // ── role 6: user-response rendezvous (lpush ↔ blpop) ──────────────────────
  /** Producer side (api): deliver a user's answer to a waiting agent. */
  pushUserResponse(jobId: string, answer: string): void {
    const queue = this.waiters.get(jobId);
    const resolve = queue?.shift();
    if (resolve) {
      resolve(answer);
      return;
    }
    // No waiter yet — buffer it, mirroring an lpush that lands before the blpop.
    const pending = this.pendingAnswers.get(jobId) ?? [];
    pending.push(answer);
    this.pendingAnswers.set(jobId, pending);
  }

  /** Consumer side (worker): block for an answer up to timeoutMs (null on timeout). */
  waitForUserResponse(jobId: string, timeoutMs: number): Promise<string | null> {
    const pending = this.pendingAnswers.get(jobId);
    if (pending && pending.length > 0) {
      return Promise.resolve(pending.shift() ?? null);
    }
    return new Promise<string | null>((resolve) => {
      let settled = false;
      const finish = (v: string | null): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const arr = this.waiters.get(jobId);
        if (arr) {
          const i = arr.indexOf(waiter);
          if (i >= 0) arr.splice(i, 1);
        }
        resolve(v);
      };
      const waiter = (answer: string): void => finish(answer);
      const arr = this.waiters.get(jobId) ?? [];
      arr.push(waiter);
      this.waiters.set(jobId, arr);
      const timer = setTimeout(() => finish(null), timeoutMs);
      timer.unref?.();
    });
  }

  // ── role 7: plan-created flag ─────────────────────────────────────────────
  markPlan(jobId: string): void {
    this.plans.set(jobId, Date.now() + PLAN_TTL_MS);
  }

  hasPlan(jobId: string): boolean {
    const exp = this.plans.get(jobId);
    if (exp === undefined) return false;
    if (exp <= Date.now()) {
      this.plans.delete(jobId);
      return false;
    }
    return true;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [jobId, buf] of this.buffers) {
      if (now - buf.lastTouched > RING_TTL_MS) {
        this.buffers.delete(jobId);
        this.cancelled.delete(jobId);
        this.waiters.delete(jobId);
        this.pendingAnswers.delete(jobId);
      }
    }
    for (const [jobId, exp] of this.plans) {
      if (exp <= now) this.plans.delete(jobId);
    }
  }
}

// Single instance for the whole process, stashed on globalThis so it survives
// --hot reloads and any dual module resolution (mirrors api/src/lib/redis.ts).
const globalForBus = globalThis as unknown as {
  __tauInProcessBus?: InProcessBus;
};

export const bus = globalForBus.__tauInProcessBus ?? new InProcessBus();
globalForBus.__tauInProcessBus = bus;
