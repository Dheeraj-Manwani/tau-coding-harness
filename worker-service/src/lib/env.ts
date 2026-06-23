import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),

  // ── Shared infra (kept identical across api / ws-gateway / worker-service) ──
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  // ── Deepseek (LLM) — via the OpenAI-compatible API ──
  DEEPSEEK_API_KEY: z.string().min(1, "DEEPSEEK_API_KEY is required"),
  // baseURL + model are not in the sprint spec but are required to actually
  // reach Deepseek; sensible defaults match the api service.
  DEEPSEEK_BASE_URL: z.string().url().default("https://api.deepseek.com"),
  DEEPSEEK_MODEL: z.string().default("deepseek-chat"),

  // ── E2B sandbox ──
  E2B_API_KEY: z.string().min(1, "E2B_API_KEY is required"),

  // ── AWS / S3 (snapshots) ──
  AWS_REGION: z.string().min(1, "AWS_REGION is required"),
  S3_BUCKET: z.string().min(1, "S3_BUCKET is required"),

  // ── Worker / queue ──
  QUEUE_NAME: z.string().default("code-generation"),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(3),
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
