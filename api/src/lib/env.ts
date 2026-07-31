import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  // Auth — ACCESS_TOKEN_SECRET signs/verifies JWTs and must be a real secret.
  ACCESS_TOKEN_SECRET: z
    .string()
    .min(16, "ACCESS_TOKEN_SECRET must be at least 16 characters"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  // App / client URLs
  APP_URL: z.string().url().default("http://localhost:5173"),
  /**
   * Deep-link base for the native app. Where `GET /auth/github/callback` sends
   * the browser when the flow was started from mobile — an in-app browser tab
   * cannot be returned to APP_URL, which would strand the user in a web page.
   * Not a `url()`: a custom scheme is not a valid URL to zod.
   */
  MOBILE_APP_URL: z.string().default("tau://"),
  OAUTH_SUCCESS_REDIRECT: z
    .string()
    .url()
    .default("http://localhost:5173/auth/callback"),

  // Email (Resend)
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("Tau <onboarding@resend.dev>"),

  // Deepseek
  DEEPSEEK_API_KEY: z.string(),
  DEEPSEEK_BASE_URL: z.string().url().default("https://api.deepseek.com"),
  DEEPSEEK_MODEL: z.string().default("deepseek-v4-pro"),
  // Mirrors worker-service/src/lib/env.ts — the /v1 gateway serves the same
  // models the build path does, so the two must agree on their ids.
  DEEPSEEK_MODEL_FLASH: z.string().default("deepseek-v4-flash"),

  KIMI_API_KEY: z.string().optional(),
  KIMI_BASE_URL: z.string().url().default("https://api.moonshot.ai/v1"),
  KIMI_EXTRACT_MODEL: z.string().default("kimi-k2.6"),
  KIMI_MODEL_MAX: z.string().default("kimi-k2.7-code"),

  ATTACHMENTS_ENABLED: z
    .string()
    .default("true")
    .transform((v) => v === "true"),
  ATTACHMENT_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(10 * 1024 * 1024),
  ATTACHMENT_MAX_IMAGE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(5 * 1024 * 1024),
  ATTACHMENT_MAX_PER_MESSAGE: z.coerce.number().int().positive().default(5),

  // Google OAuth
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CALLBACK_URL: z
    .string()
    .url()
    .default("http://localhost:3000/auth/google/callback"),

  // GitHub OAuth (account-linking for the "Connect GitHub" flow). Optional so the
  // api still boots without them — the connect endpoints just return "not
  // configured". The redirect URI must EXACTLY match the GitHub OAuth App
  // setting and the route the api actually serves (auth router mounts at /auth).
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GITHUB_REDIRECT_URI: z
    .string()
    .url()
    .default("http://localhost:8080/auth/github/callback"),
  // `repo` covers private + public repos; narrow to `public_repo` if desired.
  GITHUB_SCOPE: z.string().default("repo"),

  // E2B sandbox (used for sandbox-first file reads)
  E2B_API_KEY: z.string().min(1, "E2B_API_KEY is required"),

  // Cloudflare R2 object store
  R2_ACCOUNT_ID: z.string().min(1, "R2_ACCOUNT_ID is required"),
  R2_ACCESS_KEY_ID: z.string().min(1, "R2_ACCESS_KEY_ID is required"),
  R2_SECRET_ACCESS_KEY: z.string().min(1, "R2_SECRET_ACCESS_KEY is required"),
  R2_BUCKET: z.string().min(1, "R2_BUCKET is required"),
  R2_PUBLIC_BASE_URL: z
    .string()
    .url()
    .optional()
    .transform((v) => v?.replace(/\/+$/, "")),

  // Credits / billing — when false, credit enforcement is off (shadow mode).
  CREDITS_ENFORCE: z
    .string()
    .default("false")
    .transform((v) => v === "true"),

  // Admin API key
  ADMIN_API_KEY: z.string().optional(),
  // Admin console may show user content (prompts, messages, tool IO). Off by
  // default: those are the user's words, and an operator browsing them casually
  // is a privacy problem even when the access itself is legitimate. Every read
  // that returns content is audit-logged regardless.
  ADMIN_ALLOW_CONTENT: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  // Where operational alerts go (Slack/Discord incoming webhook). Unset = the
  // sweep still computes and logs the numbers, it just doesn't page anyone.
  ALERT_WEBHOOK_URL: z.string().url().optional(),
  // Maximum simultaneous active jobs per user enforced at reserve time (0 = no cap).
  CREDITS_MAX_CONCURRENT_JOBS: z.coerce.number().int().nonnegative().default(1),

  // ── AI gateway (/v1) ────────────────────────────────────────────────────────
  // Encrypts stored API keys at rest (AES-256-GCM). 32 bytes, hex-encoded:
  //   openssl rand -hex 32
  // Optional at the schema level ONLY so an existing deployment still boots
  // without it — it is not optional in effect. `apiKeys.ts` throws on first use
  // and `/v1` refuses to mount, so the feature cannot silently ship with no
  // encryption; it just doesn't ship.
  TAU_KEY_ENC_SECRET: z.string().optional(),

  // Enforcement is SEPARATE from CREDITS_ENFORCE and defaults to TRUE, because
  // the failure modes are opposite: a build metered in shadow mode costs tau one
  // job, while a gateway in shadow mode is an open, unbilled LLM proxy.
  // `meterGateway()` has no shadow path at all — this only gates mounting.
  GATEWAY_ENFORCE: z
    .string()
    .default("true")
    .transform((v) => v !== "false"),

  // Caps the cost of any single request, which is what bounds the check-then-
  // charge overshoot window (see gateway.service.ts).
  GATEWAY_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(4096),
  // Per-key in-flight ceiling. The other half of the overshoot bound.
  GATEWAY_MAX_CONCURRENT: z.coerce.number().int().positive().default(8),
  // Process-wide in-flight ceiling, across every key.
  //
  // The per-key limit does not bound total load: N popular deployed apps are N
  // keys, and `deploy/combined.ts` runs the api, the SSE stream and the job
  // runner in one Bun process. Without this, runtime inference from generated
  // apps can starve the builds that paying users are waiting on. Sized well
  // below the runner's headroom on purpose — shedding gateway load with a 429 is
  // recoverable, a stalled build queue is not.
  GATEWAY_MAX_CONCURRENT_GLOBAL: z.coerce
    .number()
    .int()
    .positive()
    .default(32),
  // Requests per minute per key.
  GATEWAY_RPM: z.coerce.number().int().positive().default(60),
  // Default daily spend ceiling per key, in micro-credits (20 credits). A
  // deployed app's endpoints are public and unauthenticated by default, so this
  // is the backstop against one draining the owner's balance overnight.
  GATEWAY_DEFAULT_DAILY_CAP_MICRO: z.coerce
    .bigint()
    .default(20n * 1_000_000n),
  // Refuse to start a request below this available balance.
  GATEWAY_MIN_BALANCE_MICRO: z.coerce.bigint().default(100_000n),
  // Wall-clock backstop on a single stream. Bun's http layer cannot tell us the
  // client hung up (see gateway.controller.ts), so this is the only
  // runtime-independent way to stop paying for a stream nobody is reading.
  // Generous: a backstop, not a limit.
  GATEWAY_STREAM_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(5 * 60_000),

  // Razorpay
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  RAZORPAY_PRO_PLAN_ID: z.string().optional(),
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
