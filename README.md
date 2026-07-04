# Tau

Tau is a "vibe coding" platform: a user describes what they want in a prompt, and Tau
scaffolds and iterates on a real web app for them inside a sandboxed environment,
streaming progress live to the browser. The repo also ships **tau-cli**, a standalone
multi-provider terminal coding agent that is independent of the web product.

This is a monorepo of independently deployable services — there is no shared build
tool (no turborepo/nx/workspaces) tying them together. Each subdirectory is its own
project with its own dependencies and lockfile.

## How a request flows through the system

```
 web (browser)
   │  HTTP (create project / send prompt)
   ▼
 api  ──────────────► Postgres (Prisma)
   │  enqueues a BullMQ job
   ▼
 Redis  ◄─────────────────────────────┐
   │  job picked up                   │ pub/sub events
   ▼                                  │
 worker-service                       │
   │  runs an agent loop against      │
   │  DeepSeek inside an E2B sandbox, │
   │  publishes progress events ──────┘
   │  ships built files to Cloudflare R2
   ▼
 ws-gateway
   │  authenticates the browser over WebSocket (JWT),
   │  subscribes to Redis, replays/streams events
   ▼
 web (browser)
   renders live chat tokens, file tree, and a live preview URL
```

1. **web** — user signs in and submits a prompt.
2. **api** — validates the request, persists the project in Postgres, and enqueues a
   BullMQ job on Redis.
3. **worker-service** — picks up the job, spins up an E2B sandbox, runs an LLM-driven
   agent loop (read/write/edit/bash-style tools) to build the app, and publishes
   progress events to Redis as it goes. Finished files are uploaded to Cloudflare R2.
4. **ws-gateway** — authenticates the browser's WebSocket connection with a shared
   JWT secret, subscribes to the job's Redis channel, and streams (with replay) the
   event feed down to the browser.
5. **web** — renders the incoming events as live chat output, a file tree, and an
   embedded preview of the running app.

**cli** (`tau`) is not part of this pipeline — it's a separate terminal-based coding
agent (supports Anthropic, OpenAI, DeepSeek, and Gemini) that a developer runs locally
against their own filesystem.

## Repo layout

| Directory        | What it is                                                            | Runtime      | Package manager |
|-------------------|------------------------------------------------------------------------|--------------|------------------|
| `api/`            | REST API — auth, projects, billing, credits, admin, webhooks           | Bun + Express 5 | bun |
| `worker-service/` | Background worker — runs the agent loop in an E2B sandbox, talks to R2 | Bun          | bun |
| `ws-gateway/`     | Authenticated WebSocket gateway that streams job events from Redis     | Bun          | bun |
| `web/`            | The user-facing SPA (chat, file tree, live preview, billing UI)        | Vite + React 19 | pnpm |
| `cli/`            | `tau` — standalone multi-provider terminal coding agent                | Bun + Ink/React | bun |
| `doc/`            | Internal design docs (architecture, agent loop deep-dive, roadmap). Gitignored — local only. | — | — |

`api`, `worker-service`, and `ws-gateway` share the same Postgres database and Redis
instance, and must all use the **same `ACCESS_TOKEN_SECRET`** so that connection
tokens minted by `api` verify correctly in `ws-gateway`.

## Getting started

### 1. Infrastructure

`api/docker-compose.yml` spins up Postgres 17 and Redis 7 for local development:

```bash
cd api
docker compose up -d
```

This exposes Postgres on `5432` (db `tau`, user/pass `tau`/`tau`) and Redis on `6379`,
matching the defaults in every `.env.example`.

### 2. Environment variables

Each backend service (`api`, `worker-service`, `ws-gateway`) has its own
`.env.example` — copy it to `.env` and fill in the secrets. The `SHARED` block at the
top of each file (`DATABASE_URL`, `REDIS_URL`, `ACCESS_TOKEN_SECRET`) must match
across all three services.

- **api** additionally needs: `DEEPSEEK_API_KEY`, Resend email vars, Google OAuth
  vars, Razorpay billing vars, `ADMIN_API_KEY`, `CREDITS_ENFORCE` /
  `CREDITS_MAX_CONCURRENT_JOBS`.
- **worker-service** additionally needs: `DEEPSEEK_API_KEY` (+ base URL/model),
  `E2B_API_KEY`, Cloudflare R2 credentials, `QUEUE_NAME`, `WORKER_CONCURRENCY`,
  `TAVILY_API_KEY` (for the web-search tool).
- **ws-gateway** additionally needs: just `PORT`.
- **web** only needs an optional `VITE_API_URL` if the API isn't on the default host.

### 3. Install and run each service

All Bun-based services (`api`, `worker-service`, `ws-gateway`, `cli`) follow the same
pattern:

```bash
cd <service>
bun install
bun run dev        # hot-reloading dev server
```

`web` uses pnpm:

```bash
cd web
pnpm install
pnpm dev
```

For a full local stack, run `api`, `worker-service`, and `ws-gateway` in one terminal
each, plus `web`, after Postgres/Redis are up. `api` and `worker-service` also need a
`generate` step for Prisma before their first run:

```bash
bun run generate   # inside api/ and worker-service/
```

### 4. Run the CLI agent

```bash
cd cli
bun install
bun run tau        # or: bun run src/cli.ts
```

`tau` stores its own auth/config under `~/.tau/` rather than reading a `.env` at
runtime (the `cli/.env` in this repo is only for local development of the CLI itself).

## Common scripts per service

| Service           | dev              | build / typecheck                 | test        |
|-------------------|------------------|------------------------------------|-------------|
| `api`             | `bun run dev`    | `bun run build`, `bun run typecheck` | `bun test` |
| `worker-service`  | `bun run dev`    | `bun run typecheck`                | `bun test` |
| `ws-gateway`      | `bun run dev`    | `bun run typecheck`                | — |
| `web`             | `pnpm dev`       | `pnpm build`, `pnpm lint`           | — |
| `cli`             | `bun run dev`    | `bun run typecheck`                | `bun test` |

## Further reading

`doc/` contains deeper internal design notes (not tracked in git, so only available
locally if you have them): an architecture/status overview, a deep-dive on the
worker-service agent loop and tooling, dogfooding feedback, and a production-readiness
checklist. Each subdirectory's own README (where present) has more service-specific
detail than this file.
