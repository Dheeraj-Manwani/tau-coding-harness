import OpenAI from "openai";
import { env } from "@/lib/env";
import { deepseek, LLM_MAX_RETRIES, LLM_REQUEST_TIMEOUT_MS } from "@/lib/deepseek";

/**
 * Moonshot limits an account to a number of requests at once — one, on a small
 * account — and answers any more with a 429, immediately. Left to the SDK's own
 * retries (a fraction of a second apart, twice), three builds that each want a
 * design review at the same moment mostly fail. So every call to Kimi goes
 * through here: at most `KIMI_MAX_CONCURRENT` at a time, the rest wait their
 * turn, and a 429 that still comes back is waited out and tried again.
 */
export class Gate {
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  constructor(private readonly limit: number) {}

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((resolve) => this.waiting.push(resolve));
    else this.active++;
    try {
      return await work();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
}

/** How long to wait before trying a rate-limited call again, in ms. */
export function retryDelayMs(attempt: number, retryAfter: string | null): number {
  const asked = Number(retryAfter);
  const base = Number.isFinite(asked) && asked > 0 ? asked * 1000 : 1000 * attempt;
  return Math.min(15_000, base) + Math.floor(Math.random() * 400);
}

const MAX_RATE_LIMIT_ATTEMPTS = 8;
const gate = new Gate(env.KIMI_MAX_CONCURRENT);

/** `fetch`, one call at a time per the account's limit, waiting out a 429. */
export function gatedFetch(inner: typeof fetch = fetch): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) =>
    gate.run(async () => {
      for (let attempt = 1; ; attempt++) {
        const res = await inner(input, init);
        if (res.status !== 429 || attempt >= MAX_RATE_LIMIT_ATTEMPTS) return res;
        await res.body?.cancel().catch(() => undefined);
        await new Promise((r) => setTimeout(r, retryDelayMs(attempt, res.headers.get("retry-after"))));
      }
    })) as typeof fetch;
}

export const kimi = env.KIMI_API_KEY
  ? new OpenAI({
      apiKey: env.KIMI_API_KEY,
      baseURL: env.KIMI_BASE_URL,
      timeout: LLM_REQUEST_TIMEOUT_MS,
      maxRetries: LLM_MAX_RETRIES,
      fetch: gatedFetch(),
    })
  : null;

export function isKimiModel(model: string): boolean {
  return model.startsWith("kimi-") || model.startsWith("moonshot-");
}

export function clientForModel(model: string): OpenAI {
  if (isKimiModel(model) && kimi) return kimi;
  return deepseek;
}
