import { z } from "zod";

/**
 * One environment schema for the whole backend.
 *
 * This was two files — `api/src/lib/env.ts` (200 lines) and
 * `worker-service/src/lib/env.ts` (101) — validating overlapping halves of the
 * same environment. Merging them is behaviour-preserving rather than a
 * tightening: both were already imported into the same process by
 * `combined.ts`, so the process always had to satisfy the union.
 *
 * The two definitions agreed on every shared key except `DEEPSEEK_API_KEY`,
 * where the worker's `.min(1)` was stricter than the api's bare `z.string()`.
 * The stricter one won.
 */
const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  // Reverse-proxy hops in front of this process (Express "trust proxy"). 1 for
  // a single Caddy/Nginx/Render proxy; 2 if Cloudflare's orange cloud sits in
  // front of that; 0 when exposed directly.
  TRUST_PROXY_HOPS: z.coerce.number().int().nonnegative().default(1),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  // Auth — ACCESS_TOKEN_SECRET signs/verifies JWTs and must be a real secret.
  ACCESS_TOKEN_SECRET: z
    .string()
    .min(16, "ACCESS_TOKEN_SECRET must be at least 16 characters"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  // App / client URLs
  APP_URL: z.string().url().default("http://localhost:5174"),
  /** The public marketing site. The "Built with tau" badge links visitors here. */
  LANDING_URL: z
    .string()
    .url()
    .default("https://tauai.pro")
    .transform((v) => v.replace(/\/+$/, "")),
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
    .default("http://localhost:5174/auth/callback"),

  // Email (Resend)
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("Tau <onboarding@resend.dev>"),

  // Deepseek
  DEEPSEEK_API_KEY: z.string().min(1, "DEEPSEEK_API_KEY is required"),
  DEEPSEEK_BASE_URL: z.string().url().default("https://api.deepseek.com"),
  DEEPSEEK_MODEL: z.string().default("deepseek-v4-pro"),
  // Mirrors worker-service/src/lib/env.ts — the /v1 gateway serves the same
  // models the build path does, so the two must agree on their ids.
  DEEPSEEK_MODEL_FLASH: z.string().default("deepseek-v4-flash"),

  MODEL_CONTEXT_WINDOW: z.coerce.number().int().positive().default(128_000),

  KIMI_API_KEY: z.string().optional(),
  KIMI_BASE_URL: z.string().url().default("https://api.moonshot.ai/v1"),
  KIMI_EXTRACT_MODEL: z.string().default("kimi-k2.6"),
  // Requests to Moonshot in flight at once, across every build and upload in
  // this process. A small account is allowed one; raise it with the account.
  KIMI_MAX_CONCURRENT: z.coerce.number().int().positive().default(1),
  // The model that looks at screenshots of a generated app for the design
  // review (worker/design/review.ts). Must accept images. A `kimi-` or
  // `moonshot-` model is called through the Kimi client and anything else
  // through the DeepSeek one. Defaults to the extraction model.
  DESIGN_REVIEW_MODEL: z.string().optional(),
  // Let the review model reason before it answers. Off: it was tuned that way,
  // and reasoning costs time and tokens. Tried on planted faults in phase 4 of
  // doc/CONTEXT_AND_MEMORY_PLAN.md §11.
  DESIGN_REVIEW_THINKING: z
    .string()
    .default("false")
    .transform((v) => v === "true"),

  // Gives the agent `dispatch_implementer`, a sub-agent that writes code in its
  // own context. Off while it is being tried (doc/CONTEXT_AND_MEMORY_PLAN.md §11,
  // phase 7, S1): it was written and never run.
  ENABLE_IMPLEMENTER: z
    .string()
    .default("false")
    .transform((v) => v === "true"),

  // ── Picture generation (OpenRouter) ─────────────────────────────────────────
  // Without the key there is no `generate_image` tool: nothing else changes.
  OPEN_ROUTER_API_KEY: z.string().optional(),
  OPEN_ROUTER_BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),
  // Seedream 5.0 Flash: the cheapest of ByteDance's image models that was also
  // the best at following a prompt (lib/openrouter.ts). Any OpenRouter model
  // that outputs images works here.
  IMAGE_MODEL: z.string().default("bytedance-seed/seedream-5-0-flash"),
  // Most pictures one build may make. Each costs about 18 credits.
  IMAGE_MAX_PER_RUN: z.coerce.number().int().nonnegative().default(4),
  // Pictures being made at once, across every build in this process.
  IMAGE_MAX_CONCURRENT: z.coerce.number().int().positive().default(3),

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
  // Which sandbox template generation a brand-new project boots into
  // (templates/registry.ts). 1 = the three original images, picked by the
  // agent. 2 = the single `tau-app-v2` base image, which has to be published to
  // this E2B account first (`bun run build:template --key v2-frontend`).
  // Existing projects stay on the template they were created with either way,
  // so flipping this never moves an app onto a different image.
  TEMPLATE_GENERATION: z
    .enum(["1", "2"])
    .default("1")
    .transform((v) => (v === "2" ? 2 : 1)),

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

  // Tau Cloud Storage (doc/TAU_CLOUD_STORAGE.md). Everything is optional: the
  // `/storage` surface is simply not mounted without a bucket.
  R2_STORAGE_BUCKET: z.string().min(1).optional(),
  // A token scoped to the storage bucket. Falls back to the main R2 pair.
  R2_STORAGE_ACCESS_KEY_ID: z.string().min(1).optional(),
  R2_STORAGE_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  // The address a generated app calls (`${TAU_STORAGE_URL}/uploads`). Public,
  // like TAU_AI_URL: it is used from a sandbox and from a published function.
  TAU_STORAGE_URL: z.string().url().optional(),
  // Requests a minute per storage key.
  STORAGE_RPM: z.coerce.number().int().positive().default(300),
  STORAGE_UPLOAD_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  STORAGE_URL_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  STORAGE_URL_TTL_MAX_SECONDS: z.coerce.number().int().positive().default(3600),
  // Age at which an upload that was never confirmed is swept.
  STORAGE_PENDING_TTL_MS: z.coerce.number().int().positive().default(3_600_000),

  // Credits / billing — when false, credit enforcement is off (shadow mode).
  CREDITS_ENFORCE: z
    .string()
    .default("false")
    .transform((v) => v === "true"),

  // Admin access is `User.role === ADMIN` and nothing else — there is no admin
  // key here by design. Promote the first operator by hand:
  //   UPDATE "User" SET role = 'ADMIN' WHERE email = 'you@example.com';
  //
  // Admin console may show user content (prompts, messages, tool IO). Off by
  // default: those are the user's words, and an operator browsing them casually
  // is a privacy problem even when the access itself is legitimate. Every read
  // that returns content is audit-logged regardless.
  ADMIN_ALLOW_CONTENT: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  // Origin of the standalone ops console (admin/), e.g. https://admin.tauai.pro.
  // Unset = the console is not deployed: no CORS grant on /admin and no
  // `?client=admin` Google sign-in. Must share a registrable domain with this
  // API so the SameSite=Lax admin cookie reaches it.
  ADMIN_URL: z
    .string()
    .url()
    .optional()
    .transform((v) => v?.replace(/\/+$/, "")),
  // DeepSeek balance (in the account's currency) below which the console flags
  // an anomaly and the hourly sweep pages. Every build stops when it hits zero.
  DEEPSEEK_LOW_BALANCE: z.coerce.number().nonnegative().default(5),
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
  // Hono restart work) without standing up a tunnel first. Downgrades an
  // unreachable URL from a refusal to a warning. It does NOT make an unset URL
  // usable: there is still nothing to inject.
  TAU_GATEWAY_ALLOW_UNREACHABLE: z
    .string()
    .default("false")
    .transform((v) => v === "true"),

  // ── Worker ──────────────────────────────────────────────────────────────────
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(3),
  // Max depth of sub agents.
  MAX_AGENT_DEPTH: z.string().transform((val) => Number(val)),
  TAVILY_API_KEY: z.string(),

  // Preview thumbnails (auto-screenshot on build done).
  SCREENSHOT_ENABLED: z
    .string()
    .default("true")
    .transform((v) => v === "true"),
  SCREENSHOT_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),

  // Opening the app in tau's headless browser to read its console, errors and
  // failed requests: the agent's `inspect_preview` tool and the check that an
  // app renders before a run may finish. Uses the same browser as the
  // screenshots; false turns both off (doc/PREVIEW_DIAGNOSTICS_PLAN.md).
  PREVIEW_INSPECT_ENABLED: z
    .string()
    .default("true")
    .transform((v) => v === "true"),
  // Most inspections one run may ask for. A result costs no model call, but it
  // is read again on every later step of the run.
  PREVIEW_INSPECT_MAX_PER_RUN: z.coerce.number().int().nonnegative().default(15),

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

  // ── Deploys (published sites) ───────────────────────────────────────────────
  //
  // Apex domain published sites live under, e.g. "usetau.app" serves a project
  // at "https://{slug}.usetau.app". Optional on purpose: with it unset the same
  // sites are still fully served, from `{SITES_ORIGIN}/sites/{slug}/`. That
  // keeps publishing working on a laptop and on any host without a wildcard
  // DNS record, instead of making the whole feature wait on infrastructure.
  SITES_DOMAIN: z
    .string()
    .optional()
    .transform((v) => v?.replace(/^\.+|\.+$/g, "").toLowerCase() || undefined),

  // Public origin of THIS server, used to build the path-based site URL when
  // SITES_DOMAIN is unset. Falls back to localhost:PORT at use site.
  SITES_ORIGIN: z
    .string()
    .url()
    .optional()
    .transform((v) => v?.replace(/\/+$/, "")),

  // ── Backend hosting (doc/PUBLISHING.md Phase 4) ─────────────────────────────
  //
  // Off unless BACKEND_HOSTING_ENABLED is "true" AND all four AWS settings are
  // present; either missing and publishing behaves exactly as it did before
  // backends were hosted. The credentials are for a separate AWS account that
  // holds only published apps, and may only manage functions named `tau-app-*`,
  // roles under the `/tau-apps/` path (with the permissions boundary below) and
  // those functions' log groups. See ops/aws-apps-policy.json.
  BACKEND_HOSTING_ENABLED: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  AWS_APPS_REGION: z.string().optional(),
  AWS_APPS_ACCESS_KEY_ID: z.string().optional(),
  AWS_APPS_SECRET_ACCESS_KEY: z.string().optional(),
  // The ceiling every function role is created under, so a role tau makes can
  // never grant more than the boundary allows whatever policy it is given.
  AWS_APPS_PERMISSIONS_BOUNDARY_ARN: z.string().optional(),
  // Per function. Reserved concurrency also caps what one runaway app can take
  // from the account's pool; a new account may be too small to reserve any.
  AWS_APPS_RESERVED_CONCURRENCY: z.coerce.number().int().min(0).default(2),
  AWS_APPS_MEMORY_MB: z.coerce.number().int().min(128).max(3008).default(512),
  AWS_APPS_TIMEOUT_S: z.coerce.number().int().min(1).max(60).default(15),
  AWS_APPS_LOG_RETENTION_DAYS: z.coerce.number().int().positive().default(14),

  // ── Database hosting (doc/PUBLISHING.md Phase 5) ────────────────────────────
  //
  // One Neon project per app. Off without a key (and without backend hosting,
  // which it needs): an app with a database then cannot be published, as before.
  NEON_API_KEY: z.string().optional(),
  // Same region as the functions, so a request does not cross an ocean.
  NEON_REGION_ID: z.string().default("aws-us-east-1"),
  // Only for a key that belongs to an organisation.
  NEON_ORG_ID: z.string().optional(),
  // How long a deleted project's database is kept before it is removed.
  DATABASE_DELETE_DELAY_DAYS: z.coerce.number().int().min(0).default(7),

  // The edge router's routing records (doc/PUBLISHING.md Phase 2). All three,
  // with SITES_DOMAIN, switch the registry on; with any unset nothing is pushed
  // and a laptop behaves as before. The token needs Workers KV Storage: Edit on
  // this account and nothing else.
  CLOUDFLARE_ACCOUNT_ID: z.string().optional(),
  CLOUDFLARE_KV_NAMESPACE_ID: z.string().optional(),
  CLOUDFLARE_API_TOKEN: z.string().optional(),
  // Custom domains (Phase 3) also need the zone, and a token with SSL and
  // Certificates: Edit on it. CLOUDFLARE_SAAS_TOKEN keeps that apart from the
  // KV-only token above; with it unset CLOUDFLARE_API_TOKEN is used.
  CLOUDFLARE_ZONE_ID: z.string().optional(),
  CLOUDFLARE_SAAS_TOKEN: z.string().optional(),

  // What `/sites/{slug}/…` on this server's own origin does once SITES_DOMAIN
  // is set. `serve` answers from here, which runs a published app's JavaScript
  // on the API's origin. `redirect` sends the visitor to the app's own
  // subdomain instead, so nothing user-written ever executes here. Ignored
  // while SITES_DOMAIN is unset: the path form is then the only address a site
  // has. Stays `serve` until the sites domain is live.
  SITES_PATH_MODE: z.enum(["serve", "redirect"]).default("serve"),

  // Ceilings on one published build. A static bundle that exceeds either of
  // these is a build gone wrong (a `dist/` containing node_modules, a stray
  // video) — failing loudly beats quietly uploading it to R2 on our bill.
  DEPLOY_MAX_FILES: z.coerce.number().int().positive().default(2_000),
  DEPLOY_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(100 * 1024 * 1024),
  // The largest server bundle one publish may produce, before zipping. Lambda
  // takes a 50 MB zip directly; a bundle past this is a dependency gone wrong.
  DEPLOY_MAX_BACKEND_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(20 * 1024 * 1024),
  DEPLOY_BUILD_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(5 * 60_000),

  // What a plan may publish (doc/PUBLISHING.md C12; src/lib/deployQuota.ts).
  // Set PUBLISH_QUOTAS_ENFORCE=false for local test runs that publish often.
  PUBLISH_QUOTAS_ENFORCE: z
    .string()
    .default("true")
    .transform((v) => v !== "false"),
  PUBLISHES_PER_APP_PER_DAY_FREE: z.coerce.number().int().positive().default(5),
  PUBLISHES_PER_APP_PER_DAY_PRO: z.coerce.number().int().positive().default(25),
  BACKEND_APPS_FREE: z.coerce.number().int().min(0).default(1),
  BACKEND_APPS_PRO: z.coerce.number().int().min(0).default(10),

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
