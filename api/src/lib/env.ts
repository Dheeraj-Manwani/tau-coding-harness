import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),

  // Auth — ACCESS_TOKEN_SECRET signs/verifies JWTs and must be a real secret.
  ACCESS_TOKEN_SECRET: z
    .string()
    .min(16, "ACCESS_TOKEN_SECRET must be at least 16 characters"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  // App / client URLs
  APP_URL: z.string().url().default("http://localhost:5173"),
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
  DEEPSEEK_MODEL: z.string().default("deepseek-chat"),

  // Google OAuth
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CALLBACK_URL: z
    .string()
    .url()
    .default("http://localhost:3000/auth/google/callback"),

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
