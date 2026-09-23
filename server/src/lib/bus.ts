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
  type?: string;
}

/**
 * Coarse "what is this job doing" state. Deliberately small — it exists to make
 * a stuck job legible at a glance, not to mirror the agent loop's control flow.
 */
export type JobPhase =
  | "queued"
  | "provisioning"
  | "llm"
  | `tool:${string}`
  | `subagent:${string}`
  | "waiting_user"
  | "finishing";

export interface JobRegistryEntry {
  jobId: string;
  projectId?: string;
  userId?: string;
  effort?: string;
  model?: string;
  startedAt: number;
  phase: JobPhase;
  turn: number;
  /** Last time this job did anything observable — the live stall signal. */
  lastEventAt: number;
  eventCount: number;
  toolCallCount: number;
  sandboxId: string | null;
}

export interface RunnerStats {
  queueDepth: number;
  active: number;
  concurrency: number;
}

interface JobBuffer {
  events: JobEvent[];
  lastTouched: number;
  /**
   * Next event index to hand out for this job. Monotonic and never derived from
   * `events.length` — the ring is capped (and a retried job reuses the buffer),
   * so length is not monotonic. Every index in the system comes from here; two
   * generators writing into one index space silently lost frames, because the
   * client dedups on `index <= watermark` (see doc/STUCK_THINKING_AND_TOOL_MESSAGES.md §2.5).
   */
  nextIndex: number;
  /** Set once a terminal frame (done/error/cancelled/insufficient_credits) has
   *  been emitted, so a late loser in a race can't append a second one. */
  terminal: boolean;
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
  private readonly waiters = new Map<string, Array<(v: string | null) => void>>(); // role 6
  private readonly pendingAnswers = new Map<string, string[]>(); // role 6
  private readonly activeQuestions = new Map<string, string>(); // jobId -> questionId
  private readonly plans = new Map<string, number>(); // role 7: jobId -> expiresAt
  private readonly resident = new Map<string, JobRegistryEntry>();
  private readonly registryEvents = new EventEmitter();
  private readonly runnerStats: RunnerStats = {
    queueDepth: 0,
    active: 0,
    concurrency: 0,
  };

  constructor() {
    // Many concurrent SSE subscribers / jobs — disable the listener-leak warning.
    this.events.setMaxListeners(0);
    this.dispatches.setMaxListeners(0);
    this.cancels.setMaxListeners(0);
    this.registryEvents.setMaxListeners(0);
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

  /**
   * Remove every registered dispatch handler. The economy runner is the sole
   * intended consumer of job dispatch, so it calls this before (re)registering.
   * The bus is a process-global singleton that survives `bun --hot` reloads,
   * but the runner module re-executes on every reload — without this sweep each
   * reload would leave its previous handler registered and a single dispatched
   * job would run once per accumulated handler (the model appears to "respond"
   * several times over).
   */
  clearDispatchHandlers(): void {
    this.dispatches.removeAllListeners("job");
  }

  // ── roles 2 + 3: live events + replay buffer ──────────────────────────────
  private bufferFor(jobId: string): JobBuffer {
    let buf = this.buffers.get(jobId);
    if (!buf) {
      buf = {
        events: [],
        lastTouched: Date.now(),
        nextIndex: 0,
        terminal: false,
      };
      this.buffers.set(jobId, buf);
    }
    return buf;
  }

  /**
   * Allocate the next event index for a job. The single source of indices —
   * `publish()` calls this, and it is also threaded through the agent loop as
   * the `nextIndex` callback. Callers must never compute an index themselves.
   */
  nextIndex(jobId: string): number {
    const buf = this.bufferFor(jobId);
    buf.lastTouched = Date.now();
    return buf.nextIndex++;
  }

  emit(jobId: string, event: JobEvent): void {
    const buf = this.bufferFor(jobId);
    buf.events.push(event);
    buf.lastTouched = Date.now();
    // An index handed out elsewhere (or replayed) must not let the counter go
    // backwards; keep it strictly ahead of everything emitted.
    if (event.index >= buf.nextIndex) buf.nextIndex = event.index + 1;
    if (buf.events.length > RING_MAX) {
      buf.events.splice(0, buf.events.length - RING_MAX);
    }
    // Keep the live registry's activity clock honest without a second call site:
    // anything the user sees counts as this job doing something.
    const entry = this.resident.get(jobId);
    if (entry) {
      entry.lastEventAt = Date.now();
      entry.eventCount++;
    }
    this.events.emit(jobId, event);
  }

  /**
   * Claim the right to emit this job's one terminal frame. Returns false if a
   * terminal frame was already emitted.
   *
   * Several places can legitimately end a job at once — a cancel arriving while
   * the loop is wrapping up, the reaper firing on a job that recovers — and the
   * client finalizes on the *first* one it sees. Without this claim the loser
   * appends a second, contradictory frame (a ⚠️ bubble after a clean finish).
   */
  claimTerminal(jobId: string): boolean {
    const buf = this.bufferFor(jobId);
    if (buf.terminal) return false;
    buf.terminal = true;
    return true;
  }

  /** Number of buffered events for a job (replaces `redis.llen`). */
  length(jobId: string): number {
    return this.buffers.get(jobId)?.events.length ?? 0;
  }

  /**
   * Every buffered frame for a job, in order — exactly what the user's browser
   * received. Lets the admin console replay a run frame by frame, which is the
   * difference between "the user says it hung" and seeing where it stopped.
   */
  replay(jobId: string): JobEvent[] {
    return [...(this.buffers.get(jobId)?.events ?? [])];
  }

  headIndex(jobId: string): number {
    const buf = this.buffers.get(jobId);
    if (!buf || buf.events.length === 0) return -1;
    return buf.events[buf.events.length - 1]!.index;
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
      // A capped ring can be non-empty yet no longer contain the client's next
      // frame. Replaying its tail would silently omit state transitions.
      if (buf.events[0] &&
          (buf.events[0].index > fromIndex + 1 || fromIndex > buf.events[buf.events.length - 1]!.index)) {
        onEvent({ type: "resync", index: fromIndex });
      } else {
        for (const e of buf.events) {
          if (e.index > fromIndex) onEvent(e);
        }
      }
    }
    const listener = (e: JobEvent): void => onEvent(e);
    this.events.on(jobId, listener);
    return () => void this.events.off(jobId, listener);
  }

  // ── job residency + live registry ─────────────────────────────────────────
  /**
   * Which jobs this process is actually executing right now, and what each one
   * is doing.
   *
   * Two consumers:
   *   1. the stale-job reaper — a `Job` row can look abandoned (no recent
   *      heartbeat) while the run is perfectly alive but stuck in one long turn,
   *      and reaping it would mark FAILED a job that then keeps writing;
   *   2. the admin console — "what is the box doing right now" is otherwise
   *      unanswerable without an SSH session.
   *
   * Held in memory on purpose: the whole point is that it vanishes when the
   * process does, which is exactly when the rows it was protecting become
   * reapable. Postgres holds the durable half (`Job.lastHeartbeatAt`).
   */
  markResident(jobId: string, init: Partial<JobRegistryEntry> = {}): void {
    const now = Date.now();
    this.resident.set(jobId, {
      jobId,
      startedAt: now,
      phase: "queued",
      turn: 0,
      lastEventAt: now,
      eventCount: 0,
      toolCallCount: 0,
      sandboxId: null,
      ...init,
    });
  }

  clearResident(jobId: string): void {
    this.resident.delete(jobId);
  }

  isResident(jobId: string): boolean {
    return this.resident.has(jobId);
  }

  /** How long this job has been executing here, or null if it isn't. */
  residentForMs(jobId: string): number | null {
    const entry = this.resident.get(jobId);
    return entry === undefined ? null : Date.now() - entry.startedAt;
  }

  /**
   * Record what a resident job is doing. A no-op for a job this process isn't
   * running, so callers never have to check first.
   *
   * Called from the same places that already `publish()`, so the operator view
   * and the user's view are written from one code path and cannot drift.
   */
  setPhase(jobId: string, phase: JobPhase, patch: Partial<JobRegistryEntry> = {}): void {
    const entry = this.resident.get(jobId);
    if (!entry) return;
    entry.phase = phase;
    entry.lastEventAt = Date.now();
    Object.assign(entry, patch);
    this.registryEvents.emit("change", { ...entry });
  }

  /** Snapshot of one resident job, or null. */
  registryEntry(jobId: string): JobRegistryEntry | null {
    const entry = this.resident.get(jobId);
    return entry ? { ...entry } : null;
  }

  /** Snapshot of everything executing right now. */
  registrySnapshot(): JobRegistryEntry[] {
    return [...this.resident.values()].map((e) => ({ ...e }));
  }

  /** Subscribe to registry transitions across all jobs (the admin firehose). */
  onRegistryChange(cb: (e: JobRegistryEntry) => void): () => void {
    this.registryEvents.on("change", cb);
    return () => void this.registryEvents.off("change", cb);
  }

  /**
   * Runner counters. `startRunner` keeps these as locals; lifting them here is
   * what makes queue depth answerable from an HTTP handler.
   */
  setRunnerStats(stats: Partial<RunnerStats>): void {
    Object.assign(this.runnerStats, stats);
  }

  runnerSnapshot(): RunnerStats {
    return { ...this.runnerStats };
  }

  // ── role 4: cancellation ──────────────────────────────────────────────────
  requestCancel(jobId: string): void {
    this.cancelled.add(jobId);
    // A worker blocked at ask_user must release its runner slot immediately,
    // not wait for the question's ten-minute timeout.
    for (const resolve of [...(this.waiters.get(jobId) ?? [])]) resolve(null);
    this.pendingAnswers.delete(jobId);
    this.activeQuestions.delete(jobId);
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
  registerQuestion(jobId: string, questionId: string): void {
    this.activeQuestions.set(jobId, questionId);
    this.pendingAnswers.delete(jobId);
  }

  isQuestionActive(jobId: string, questionId: string): boolean {
    return this.activeQuestions.get(jobId) === questionId;
  }

  clearQuestion(jobId: string, questionId: string): void {
    if (this.isQuestionActive(jobId, questionId)) {
      this.activeQuestions.delete(jobId);
      this.pendingAnswers.delete(jobId);
    }
  }

  /** Producer side (api): deliver a user's answer to a waiting agent. */
  pushUserResponse(jobId: string, questionId: string, answer: string): void {
    if (this.cancelled.has(jobId) || !this.isQuestionActive(jobId, questionId)) return;
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
  waitForUserResponse(
    jobId: string,
    timeoutMs: number,
  ): Promise<string | null> {
    if (this.cancelled.has(jobId)) return Promise.resolve(null);
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
      const waiter = (answer: string | null): void => finish(answer);
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
      // Never evict a job this process is still executing. Dropping its buffer
      // would reset `nextIndex` to 0, and the next frame it emitted would land
      // at an index the client has already seen — silently discarded by the
      // `index <= watermark` dedup, terminal frames included.
      if (this.resident.has(jobId)) continue;
      if (now - buf.lastTouched > RING_TTL_MS) {
        this.buffers.delete(jobId);
        this.cancelled.delete(jobId);
        this.waiters.delete(jobId);
        this.pendingAnswers.delete(jobId);
        this.activeQuestions.delete(jobId);
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
