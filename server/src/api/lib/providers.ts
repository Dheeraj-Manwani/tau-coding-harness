import { Sandbox } from "e2b";
import { z } from "zod";
import { env } from "@/lib/env";
import { captureException } from "./log";
import { memo } from "./memo";

/**
 * "How much runway do we have?" — read-only account checks against the paid
 * services tau runs on, for the ops console and the hourly alert sweep.
 *
 * Every check:
 *   - is cached (5 min on success, 1 min on failure) and only runs when someone
 *     asks — the console is open, or the hourly sweep fires;
 *   - has an 8 s ceiling;
 *   - never throws. A provider being down is a *finding*, reported as
 *     `status: "error"`, not a reason for the console to 500.
 *
 * None of these endpoints bill per call.
 */

const TTL_OK_MS = 5 * 60_000;
const TTL_ERROR_MS = 60_000;
const TIMEOUT_MS = 8_000;
const E2B_MAX_SANDBOXES = 500;

export type Check<T> =
  | { status: "ok"; data: T; fetchedAt: string }
  | { status: "error"; error: string; fetchedAt: string }
  | { status: "unconfigured"; fetchedAt: string };

async function check<T>(
  key: string,
  configured: boolean,
  fetcher: () => Promise<T>,
  fresh: boolean,
): Promise<Check<T>> {
  const { value } = await memo<Check<T>>(
    `provider:${key}`,
    async () => {
      const fetchedAt = new Date().toISOString();
      if (!configured) return { status: "unconfigured", fetchedAt };
      try {
        return { status: "ok", data: await fetcher(), fetchedAt };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        captureException(err, { detail: `provider check failed: ${key}` });
        return { status: "error", error: message.slice(0, 300), fetchedAt };
      }
    },
    {
      ttlMs: TTL_OK_MS,
      ttlFor: (v) => (v.status === "error" ? TTL_ERROR_MS : TTL_OK_MS),
      fresh,
    },
  );
  return value;
}

async function getJson(url: string, apiKey: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    // The body of an auth failure is the provider's own message — useful, and
    // it never contains our key. Truncated so a stray HTML page stays small.
    const body = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(`HTTP ${res.status}${body ? `: ${body}` : ""}`);
  }
  return res.json();
}

// ── DeepSeek ─────────────────────────────────────────────────────────────────

export interface DeepseekBalance {
  available: boolean;
  balances: Array<{ currency: string; total: number; granted: number; toppedUp: number }>;
}

const money = z.coerce.number().catch(0);

const deepseekSchema = z.object({
  is_available: z.boolean(),
  balance_infos: z
    .array(
      z.object({
        currency: z.string(),
        total_balance: money,
        granted_balance: money.optional(),
        topped_up_balance: money.optional(),
      }),
    )
    .default([]),
});

/** `GET /user/balance` — balances arrive as decimal strings ("110.00"). */
export function parseDeepseekBalance(json: unknown): DeepseekBalance {
  const parsed = deepseekSchema.parse(json);
  return {
    available: parsed.is_available,
    balances: parsed.balance_infos.map((b) => ({
      currency: b.currency,
      total: b.total_balance,
      granted: b.granted_balance ?? 0,
      toppedUp: b.topped_up_balance ?? 0,
    })),
  };
}

export function deepseekBalance(fresh = false): Promise<Check<DeepseekBalance>> {
  // The balance endpoint lives at the API root, not under an OpenAI-style /v1.
  const base = env.DEEPSEEK_BASE_URL.replace(/\/+$/, "").replace(/\/v1$/, "");
  return check(
    "deepseek",
    Boolean(env.DEEPSEEK_API_KEY),
    async () => parseDeepseekBalance(await getJson(`${base}/user/balance`, env.DEEPSEEK_API_KEY)),
    fresh,
  );
}

// ── Kimi / Moonshot ──────────────────────────────────────────────────────────

export interface KimiBalance {
  currency: string;
  available: number;
  voucher: number;
  cash: number;
}

const kimiSchema = z.object({
  data: z.object({
    available_balance: money,
    voucher_balance: money.optional(),
    cash_balance: money.optional(),
  }),
});

/** `GET /v1/users/me/balance`. moonshot.ai bills in USD, moonshot.cn in CNY. */
export function parseKimiBalance(json: unknown, currency: string): KimiBalance {
  const { data } = kimiSchema.parse(json);
  return {
    currency,
    available: data.available_balance,
    voucher: data.voucher_balance ?? 0,
    cash: data.cash_balance ?? 0,
  };
}

export function kimiBalance(fresh = false): Promise<Check<KimiBalance>> {
  const base = env.KIMI_BASE_URL.replace(/\/+$/, "");
  const currency = /moonshot\.cn/i.test(base) ? "CNY" : "USD";
  return check(
    "kimi",
    Boolean(env.KIMI_API_KEY),
    async () =>
      parseKimiBalance(await getJson(`${base}/users/me/balance`, env.KIMI_API_KEY!), currency),
    fresh,
  );
}

// ── Tavily ───────────────────────────────────────────────────────────────────

export interface TavilyUsage {
  plan: string | null;
  planUsage: number | null;
  planLimit: number | null;
  paygoUsage: number | null;
  paygoLimit: number | null;
  keyUsage: number | null;
  keyLimit: number | null;
}

const count = z.number().nullable().optional();

const tavilySchema = z.object({
  key: z.object({ usage: count, limit: count }).partial().optional(),
  account: z
    .object({
      current_plan: z.string().nullable().optional(),
      plan_usage: count,
      plan_limit: count,
      paygo_usage: count,
      paygo_limit: count,
    })
    .partial()
    .optional(),
});

/** `GET https://api.tavily.com/usage` — credits used against plan and key. */
export function parseTavilyUsage(json: unknown): TavilyUsage {
  const { key, account } = tavilySchema.parse(json);
  return {
    plan: account?.current_plan ?? null,
    planUsage: account?.plan_usage ?? null,
    planLimit: account?.plan_limit ?? null,
    paygoUsage: account?.paygo_usage ?? null,
    paygoLimit: account?.paygo_limit ?? null,
    keyUsage: key?.usage ?? null,
    keyLimit: key?.limit ?? null,
  };
}

export function tavilyUsage(fresh = false): Promise<Check<TavilyUsage>> {
  return check(
    "tavily",
    Boolean(env.TAVILY_API_KEY),
    async () => parseTavilyUsage(await getJson("https://api.tavily.com/usage", env.TAVILY_API_KEY)),
    fresh,
  );
}

// ── E2B ──────────────────────────────────────────────────────────────────────

export interface LiveSandbox {
  sandboxId: string;
  templateId: string;
  name: string | null;
  state: string;
  startedAt: string;
  endAt: string;
  cpuCount: number;
  memoryMB: number;
  metadata: Record<string, string>;
  /** The dev server's public URL; null while paused, when nothing is serving. */
  previewUrl: string | null;
}

/** The port every template's Vite dev server listens on (the worker's PREVIEW_PORT). */
const PREVIEW_PORT = 5173;

/**
 * Public URL of a sandbox's dev server — what the SDK's `getHost` returns, which
 * is a pure function of the id. Built by hand so the console never has to
 * `Sandbox.connect`: that resumes a paused sandbox, and starts it billing.
 */
export function e2bPreviewUrl(sandboxId: string, domain?: string): string {
  return `https://${PREVIEW_PORT}-${sandboxId}.${domain || process.env.E2B_DOMAIN || "e2b.app"}`;
}

/**
 * Every running or paused sandbox on the account — one paginated list call,
 * not a probe per sandbox. This is what makes leaks countable: E2B is the
 * source of truth for what is billing, `Project.sandboxId` only for what we
 * think we own.
 */
export function e2bSandboxes(fresh = false): Promise<Check<LiveSandbox[]>> {
  return check(
    "e2b",
    Boolean(env.E2B_API_KEY),
    async () => {
      const paginator = Sandbox.list({
        apiKey: env.E2B_API_KEY,
        query: { state: ["running", "paused"] },
        limit: 100,
        requestTimeoutMs: TIMEOUT_MS,
      });
      const out: LiveSandbox[] = [];
      while (paginator.hasNext && out.length < E2B_MAX_SANDBOXES) {
        for (const s of await paginator.nextItems()) {
          out.push({
            sandboxId: s.sandboxId,
            templateId: s.templateId,
            name: s.name ?? null,
            state: s.state,
            startedAt: new Date(s.startedAt).toISOString(),
            endAt: new Date(s.endAt).toISOString(),
            cpuCount: s.cpuCount,
            memoryMB: s.memoryMB,
            metadata: s.metadata ?? {},
            previewUrl: s.state === "running" ? e2bPreviewUrl(s.sandboxId, s.sandboxDomain) : null,
          });
        }
      }
      return out;
    },
    fresh,
  );
}
