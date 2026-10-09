/**
 * Response shapes of the server's /admin/* endpoints, as they arrive over JSON
 * (dates are ISO strings, BigInt micro-credits are strings).
 *
 * Mirrors server/src/api/services/admin.service.ts and adminOverview.service.ts
 * by hand — this app deliberately shares no code with the server, so it keeps
 * working (and building) whatever state the server tree is in.
 */

export type ISODate = string;

// ── shared ───────────────────────────────────────────────────────────────────

export type Severity = "info" | "warn" | "critical";

export interface Anomaly {
  key: string;
  severity: Severity;
  message: string;
  value: number;
}

export type Check<T> =
  | { status: "ok"; data: T; fetchedAt: ISODate }
  | { status: "error"; error: string; fetchedAt: ISODate }
  | { status: "unconfigured"; fetchedAt: ISODate };

export type JobStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

export interface Me {
  id: string;
  email: string;
}

// ── providers ────────────────────────────────────────────────────────────────

export interface DeepseekBalance {
  available: boolean;
  balances: Array<{ currency: string; total: number; granted: number; toppedUp: number }>;
}

export interface KimiBalance {
  currency: string;
  available: number;
  voucher: number;
  cash: number;
}

export interface TavilyUsage {
  plan: string | null;
  planUsage: number | null;
  planLimit: number | null;
  paygoUsage: number | null;
  paygoLimit: number | null;
  keyUsage: number | null;
  keyLimit: number | null;
}

// ── runtime ──────────────────────────────────────────────────────────────────

export interface AdminHealth {
  ok: boolean;
  queueDepth: number;
  active: number;
  concurrency: number;
  residentJobs: number;
  stuckJobs: number;
  activeHolds: number;
  orphanHolds: number;
  uptimeSeconds: number;
  memoryMB: number;
}

export interface ProcessStats {
  uptimeSeconds: number;
  pid: number;
  runtime: string;
  platform: string;
  release: string | null;
  memory: { rssMB: number; heapUsedMB: number; heapTotalMB: number; externalMB: number };
  container: { limitMB: number | null; usedMB: number | null };
  disk: { totalGB: number; freeGB: number } | null;
  load: number[];
  cpus: number;
  eventLoop: { maxMs1m: number; avgMs1m: number; maxMs15m: number };
}

export interface RouteSummary {
  route: string;
  count: number;
  s4xx: number;
  s5xx: number;
  avgMs: number;
  maxMs: number;
}

export interface HttpSummary {
  windowMinutes: number;
  trackingSince: ISODate;
  requests: number;
  byClass: Record<"2xx" | "3xx" | "4xx" | "5xx", number>;
  rate5xx: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  perMinute: number[];
  topRoutes: RouteSummary[];
  slowRoutes: RouteSummary[];
  failingRoutes: RouteSummary[];
}

export interface ErrorGroup {
  fingerprint: string;
  event: string;
  level: "warn" | "error";
  svc: string;
  message: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
  lastFields: Record<string, unknown>;
}

export interface RecentLogLine {
  ts: number;
  level: "warn" | "error";
  svc: string;
  event: string;
  message: string;
  fields: Record<string, unknown>;
}

export interface ErrorSummary {
  trackingSince: ISODate;
  last15m: { errors: number; warns: number };
  last60m: { errors: number; warns: number };
  groups: ErrorGroup[];
  recent: RecentLogLine[];
}

// ── jobs ─────────────────────────────────────────────────────────────────────

export interface WindowMetrics {
  window: string;
  jobs: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  successRate: number | null;
  finishReasons: Record<string, number>;
  p50DurationSeconds: number | null;
  p95DurationSeconds: number | null;
  p50QueueWaitSeconds: number | null;
  p95QueueWaitSeconds: number | null;
  avgTurns: number | null;
  credits: number;
  creditsPerJob: number | null;
  byEffort: Record<string, { jobs: number; credits: number }>;
  toolCalls: number;
  toolFailures: number;
  toolFailureRate: number | null;
  topFailingTools: Array<{ tool: string; calls: number; failures: number }>;
  sandboxProvisionFailureRate: number | null;
}

export interface JobRegistryEntry {
  jobId: string;
  projectId?: string;
  userId?: string;
  effort?: string;
  model?: string;
  startedAt: number;
  phase: string;
  turn: number;
  lastEventAt: number;
  eventCount: number;
  toolCallCount: number;
  sandboxId: string | null;
}

export interface JobListItem {
  id: string;
  projectId: string;
  userId: string | null;
  status: JobStatus;
  type: string;
  effort: string;
  finishReason: string | null;
  model: string | null;
  attemptNumber: number;
  currentTurn: number;
  queuedAt: ISODate;
  startedAt: ISODate | null;
  completedAt: ISODate | null;
  ageSeconds: number;
  heartbeatAgeSeconds: number | null;
  inputTokens: number;
  outputTokens: number;
  credits: number;
  error: string | null;
  live: (JobRegistryEntry & { phaseAgeSeconds: number }) | null;
  stuck: boolean;
}

export interface JobInsights {
  cache?: { turns: number; inputTokens: number; cachedTokens: number; cachedPct: number };
  summaries?: number;
  design?: { style: string; accent: string; mode: string; source: string; read: string };
  reviews?: Array<{
    verdict: string;
    routes: string[];
    screens: number;
    steps: number;
    reference: boolean;
    captureMs: number;
    modelMs: number;
  }>;
  /** The run said it was done over an app that did not work, and was sent back. */
  render?: { sentBack: string };
  /** The run ended with the app still not compiling. */
  endedNotCompiling?: boolean;
}

export interface JobDetail {
  job: {
    id: string;
    projectId: string;
    status: JobStatus;
    type: string;
    effort: string;
    prompt: string | null;
    queuedAt: ISODate;
    startedAt: ISODate | null;
    completedAt: ISODate | null;
    error: string | null;
    attemptNumber: number;
    maxAttempts: number;
    lastHeartbeatAt: ISODate | null;
    currentTurn: number;
    finishReason: string | null;
    model: string | null;
    sandboxId: string | null;
    inputTokens: number;
    outputTokens: number;
    costMicro: string;
    credits: number;
    /** Cache hits, summaries, the look chosen, design reviews. Null on runs from before these were kept. */
    insights: JobInsights | null;
    project: { id: string; name: string; userId: string };
  };
  live?: JobRegistryEntry | null;
  timeline: Array<{
    id: string;
    sequence: number;
    role: string;
    type: string;
    createdAt: ISODate;
    inputTokens: number;
    outputTokens: number;
    content: unknown;
    toolCalls: Array<{
      toolCallId: string;
      toolName: string;
      status: string;
      error: string | null;
      startedAt: ISODate | null;
      completedAt: ISODate | null;
      durationMs: number | null;
      input: unknown;
      output: unknown;
    }>;
  }>;
  usage: Array<{ model: string; inputTokens: number; outputTokens: number; recordedAt: ISODate }>;
  checkpoints: Array<{ upToSequence: number; tokensBefore: number; tokensAfter: number; createdAt: ISODate }>;
  hold: {
    status: string;
    amount: string;
    consumed: string;
    createdAt: ISODate;
    settledAt: ISODate | null;
  } | null;
  contentRedacted: boolean;
}

export interface JobEvents {
  jobId: string;
  events: Array<{ type: string; index: number; [k: string]: unknown }>;
}

export interface RecentFailure {
  id: string;
  projectId: string;
  type: string;
  effort: string;
  finishReason: string | null;
  error: string | null;
  queuedAt: ISODate;
  completedAt: ISODate | null;
  userId: string;
}

// ── overview ─────────────────────────────────────────────────────────────────

export interface Overview {
  generatedAt: ISODate;
  cacheAgeSeconds: number;
  anomalies: Anomaly[];
  runtime: { health: AdminHealth; process: ProcessStats; draining: boolean };
  providers: {
    deepseek: Check<DeepseekBalance>;
    deepseekLowBalance: number;
    kimi: Check<KimiBalance>;
    tavily: Check<TavilyUsage>;
    e2b: {
      status: "ok" | "error" | "unconfigured";
      error?: string;
      orphans: number;
      staleDbRows: number;
      running: number;
      paused: number;
    };
  };
  http: HttpSummary;
  errors: {
    last15m: { errors: number; warns: number };
    last60m: { errors: number; warns: number };
    topGroups: ErrorGroup[];
  };
  jobs: { metrics: WindowMetrics[]; recentFailures: RecentFailure[] };
  users: {
    total: number;
    signups24h: number;
    signups7d: number;
    activeBuilders24h: number;
    activeBuilders7d: number;
  };
  business: {
    plans: Record<string, number>;
    subscriptions: Record<string, number>;
    credits24h: Record<string, { entries: number; credits: number }>;
    promoRedemptions7d: number;
  };
  projects: { total: number; created24h: number; liveSites: number };
  deploys24h: Record<string, number>;
  attachments24h: Record<string, number>;
  feedback7d: { count: number; avgRating: number | null };
  webhooks: { backlog: number; received24h: number };
  gateway: {
    h1: { requests: number; errors: number; credits: number };
    h24: { requests: number; errors: number; credits: number };
  };
}

// ── sandboxes ────────────────────────────────────────────────────────────────

export interface LiveSandboxRow {
  sandboxId: string;
  templateId: string;
  name: string | null;
  state: string;
  startedAt: ISODate;
  endAt: ISODate;
  cpuCount: number;
  memoryMB: number;
  metadata: Record<string, string>;
  /** The dev server's public URL; null while paused. */
  previewUrl: string | null;
  ageMinutes: number;
  project: {
    id: string;
    name: string;
    userId: string;
    email: string;
    sandboxStatus: string;
    updatedAt: ISODate;
  } | null;
  residentJobId: string | null;
  orphan: boolean;
}

export interface LiveSandboxes {
  status: "ok" | "error" | "unconfigured";
  error?: string;
  fetchedAt: ISODate;
  truncated: boolean;
  total: number;
  running: number;
  paused: number;
  orphans: number;
  staleDbRows: number;
  sandboxes: LiveSandboxRow[];
  stale: Array<{ projectId: string; name: string; sandboxId: string | null; updatedAt: ISODate }>;
}

// ── users / projects ─────────────────────────────────────────────────────────

export interface UserSearchRow {
  id: string;
  email: string;
  displayName: string | null;
  role: "USER" | "ADMIN";
  createdAt: ISODate;
  emailVerifiedAt: ISODate | null;
  plan: string | null;
  availableCredits: number;
  projects: number;
}

export interface UserDetail {
  user: {
    id: string;
    email: string;
    displayName: string | null;
    role: "USER" | "ADMIN";
    emailVerifiedAt: ISODate | null;
    createdAt: ISODate;
  };
  projects: number;
  projectList: Array<{
    id: string;
    name: string;
    templateKey: string;
    sandboxStatus: string;
    slug: string | null;
    liveDeploymentId: string | null;
    createdAt: ISODate;
    updatedAt: ISODate;
  }>;
  billing: {
    plan: string;
    freeCredits: number;
    planCredits: number;
    bonusCredits: number;
    availableCredits: number;
    reservedCredits: number;
    cycleStart: ISODate | null;
    cycleEnd: ISODate | null;
  } | null;
  activeHolds: Array<{ jobId: string; amount: string; consumed: string; createdAt: ISODate; resident: boolean }>;
  recentJobs: Array<{
    id: string;
    projectId: string;
    status: JobStatus;
    finishReason: string | null;
    effort: string;
    queuedAt: ISODate;
    completedAt: ISODate | null;
    currentTurn: number;
    credits: number;
  }>;
  spend7dByModel: Array<{ model: string; inputTokens: number; outputTokens: number }>;
  gatewaySpend7dByAlias: Array<{
    alias: string;
    requests: number;
    inputTokens: number;
    outputTokens: number;
    credits: number;
  }>;
  apiKeys: Array<{
    id: string;
    prefix: string;
    status: string;
    createdAt: ISODate;
    lastUsedAt: ISODate | null;
    revokeAfter: ISODate | null;
    dailyCapCredits: number | null;
  }>;
}

export interface ProjectDetail {
  project: {
    id: string;
    name: string;
    userId: string;
    createdAt: ISODate;
    updatedAt: ISODate;
    templateKey: string;
    sandboxId: string | null;
    sandboxStatus: string;
    sandboxExpiresAt: ISODate | null;
    githubRepo: string | null;
    /** Set while the row says READY; the row can be stale, so the link may 404. */
    previewUrl: string | null;
    /** The published site's address, from the first publish on. Null before. */
    slug: string | null;
    siteUrl: string | null;
    /** Null when nothing is live: never published, or taken offline. */
    liveDeploymentId: string | null;
    siteSuspendedAt: ISODate | null;
    /** Shown to the owner in their Publish panel. */
    siteSuspendedReason: string | null;
  };
  fileCount: number;
  messageCount: number;
  checkpoints: Array<{ upToSequence: number; tokensBefore: number; tokensAfter: number; createdAt: ISODate }>;
  jobs: Array<{
    id: string;
    status: JobStatus;
    finishReason: string | null;
    effort: string;
    queuedAt: ISODate;
    completedAt: ISODate | null;
    currentTurn: number;
    credits: number;
  }>;
}

// ── gateway / feedback / tools ───────────────────────────────────────────────

export interface GatewayOverview {
  windowHours: number;
  since: ISODate;
  totals: { requests: number; credits: number };
  byAlias: Array<{ alias: string; requests: number; credits: number }>;
  topKeys: Array<{
    apiKeyId: string;
    userId: string;
    prefix: string | null;
    status: string | null;
    requests: number;
    credits: number;
    inputTokens: number;
    outputTokens: number;
  }>;
}

export interface FeedbackPage {
  entries: Array<{
    id: string;
    userId: string;
    rating: number;
    kind: string;
    message: string | null;
    projectId: string | null;
    source: string;
    createdAt: ISODate;
    user: { email: string };
    attachments: Array<{ id: string; filename: string; mimeType: string; url: string | null }>;
  }>;
  nextCursor: string | null;
}

export interface ReapResult {
  reaped: number;
  jobIds: string[];
  errors: string[];
}

export interface GrantCreditsResult {
  granted: number;
  availableCredits: number;
}

export interface SetPlanResult {
  plan: string;
  availableCredits: number;
}

export interface ReconcileAccountResult {
  userId: string;
  ok: boolean;
  grossDriftMicro: string;
  reservedDriftMicro: string;
  actualGrossMicro: string;
  ledgerSumMicro: string;
  actualReservedMicro: string;
  activeHoldSumMicro: string;
}

export interface ReconcileJobResult {
  jobId: string;
  ok: boolean;
  chargedMicro: string;
  tokenCostMicro: string;
  driftMicro: string;
}

export interface CostSeed {
  providerPricesAsOf: string;
  products: Array<{ id: string; label: string; grossInr: number; credits: number }>;
  models: Array<{
    id: string;
    label: string;
    note: string;
    cacheHitUsd: number;
    inputUsd: number;
    outputUsd: number;
    inputCreditsPerM: number;
    outputCreditsPerM: number;
  }>;
}

export interface PromoCodeRow {
  id: string;
  code: string;
  credits: number;
  description: string | null;
  redeemedCount: number;
  maxRedemptions: number | null;
  perUserLimit: number;
  expiresAt: ISODate | null;
  isActive: boolean;
  createdAt: ISODate;
  status: "active" | "inactive" | "expired" | "used_up";
  /** Past its expiry, whatever `isActive` says. */
  expired: boolean;
  /** At its redemption cap, whatever `isActive` says. */
  usedUp: boolean;
}

export interface PromoCodeResult {
  id: string;
  code: string;
  credits: number;
  description: string | null;
  maxRedemptions: number | null;
  perUserLimit: number;
  expiresAt: ISODate | null;
  createdAt: ISODate;
}
