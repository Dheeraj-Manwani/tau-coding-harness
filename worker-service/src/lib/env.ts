import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),

  // ── Shared infra (kept identical with api/src/lib/env.ts) ──
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  // ── Deepseek (LLM) — via the OpenAI-compatible API ──
  DEEPSEEK_API_KEY: z.string().min(1, "DEEPSEEK_API_KEY is required"),
  // baseURL + model are not in the sprint spec but are required to actually
  // reach Deepseek; sensible defaults match the api service.
  DEEPSEEK_BASE_URL: z.string().url().default("https://api.deepseek.com"),
  DEEPSEEK_MODEL: z.string().default("deepseek-v4-pro"),
  DEEPSEEK_MODEL_FLASH: z.string().default("deepseek-v4-flash"),
  MODEL_CONTEXT_WINDOW: z.coerce.number().int().positive().default(128_000),

  KIMI_API_KEY: z.string().optional(),
  KIMI_BASE_URL: z.string().url().default("https://api.moonshot.ai/v1"),
  KIMI_MODEL_MAX: z.string().default("kimi-k2.7-code"),

  // ── E2B sandbox ──
  E2B_API_KEY: z.string().min(1, "E2B_API_KEY is required"),

  // ── AI gateway (/v1) ────────────────────────────────────────────────────────
  // Must match api/src/lib/env.ts — the worker decrypts the same rows the api
  // encrypted. Optional here for the same reason it is there: an unset secret
  // disables `enable_ai` rather than stopping the service from booting.
  TAU_KEY_ENC_SECRET: z.string().optional(),
  // Base URL a generated app `fetch`es for AI — `${TAU_AI_URL}/chat`. This is
  // the one the agent is told to use.
  //
  // **Deliberately no default.** These are consumed inside an E2B sandbox — a
  // remote VM — so a `localhost` value is not merely wrong, it is the sandbox's
  // own loopback and every AI call connect-refuses. A default made that failure
  // silent and invisible until someone read the generated app's logs. Unset now
  // fails loudly at `enable_ai` instead (see `checkGatewayReachability`).
  TAU_AI_URL: z.string().url().optional(),
  // The OpenAI-compatible base, injected alongside it for anyone pointing an SDK
  // at tau from outside the sandbox.
  TAU_API_URL: z.string().url().optional(),
  // Escape hatch for testing the injection mechanics (does `.env` land, does the
  // Hono restart work) without standing up a tunnel first — which is exactly how
  // §4's live verification was done. Downgrades an unreachable URL from a
  // refusal to a warning. It does NOT make an unset URL usable: there is still
  // nothing to inject.
  TAU_GATEWAY_ALLOW_UNREACHABLE: z
    .string()
    .default("false")
    .transform((v) => v === "true"),

  // ── R2
  R2_ACCOUNT_ID: z.string().min(1, "R2_ACCOUNT_ID is required"),
  R2_ACCESS_KEY_ID: z.string().min(1, "R2_ACCESS_KEY_ID is required"),
  R2_SECRET_ACCESS_KEY: z.string().min(1, "R2_SECRET_ACCESS_KEY is required"),
  R2_BUCKET: z.string().min(1, "R2_BUCKET is required"),
  R2_PUBLIC_BASE_URL: z
    .string()
    .url()
    .optional()
    .transform((v) => v?.replace(/\/+$/, "")),

  // ── Worker ──
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(3),

  CREDITS_ENFORCE: z
    .string()
    .default("false")
    .transform((v) => v === "true"),

  // Max depth of sub agents
  MAX_AGENT_DEPTH: z.string().transform((val) => Number(val)),
  TAVILY_API_KEY: z.string(),

  // ── Preview thumbnails (auto-screenshot on build done) ──
  SCREENSHOT_ENABLED: z
    .string()
    .default("true")
    .transform((v) => v === "true"),
  SCREENSHOT_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    console.error(`Invalid environment variables:\n${issues}\n`);
    process.exit(1);
  }

  return parsed.data;
}

export const env = loadEnv();
