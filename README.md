# Tau

Tau is a "vibe coding" platform: a user describes what they want in a prompt, and Tau
scaffolds and iterates on a real web app for them inside a sandboxed environment,
streaming progress live to the browser. The repo also ships **tau-cli**, a standalone
multi-provider terminal coding agent that is independent of the web product.

This is a monorepo of independently deployable services — there is no shared build
tool (no turborepo/nx/workspaces) tying them together. Each subdirectory is its own
project with its own dependencies and lockfile.

> **Two ways to run this repo.** Production runs the **economy** build: one Bun
> process, Postgres only. Local dev still runs the **four-service split** with
> Redis. Both are supported; they are described separately below. If you only
> care about one, that's the economy build — it's what's deployed.

## How a request flows through the system (economy — what's deployed)

```
 web (SPA)                         mobile (Expo)
   │  HTTP + EventSource             │  HTTP + react-native-sse
   └─────────────┬───────────────────┘
                 ▼
 deploy/combined.ts ── one Bun process, one port ──► Postgres (Prisma)
   ├─ api routes            (api/src/index.ts)
   ├─ SSE stream + cancel   (deploy/sse-route.ts)
   ├─ in-process bus        (deploy/in-process-bus.ts)
   └─ job runner            (worker-service startRunner)
                 │
                 ▼
        E2B sandbox — agent loop against Deepseek / Kimi,
        built files shipped to Cloudflare R2
```

1. A user signs in on `web` or `mobile` and submits a prompt.
2. `combined.ts` validates it, persists the project in Postgres, and dispatches
   the job on the **in-process bus** — the module that absorbed everything Redis
   used to do (dispatch, event fan-out, replay buffer, cancel, rate limiting,
   the `ask_user` rendezvous).
3. The runner picks it up, spins up an E2B sandbox, and runs an LLM-driven agent
   loop (read/write/edit/bash-style tools) to build the app, publishing progress
   events as it goes. Finished files are uploaded to Cloudflare R2.
4. The client streams those events over **SSE**
   (`GET /jobs/:jobId/stream?lastEventIndex=N`, with replay) and renders live
   chat output, a file tree, and an embedded preview of the running app.
   Cancel is `POST /jobs/:jobId/cancel`.

**The tradeoff to know:** the runner is in-memory. A process restart drops
queued and in-flight jobs — the reaper cleans the rows up so nothing bricks a
project, but the work is lost and the user resubmits. This was accepted
deliberately; see `doc/archive/economy-deployment.md`.

**cli** (`tau`) is not part of this pipeline — it's a separate terminal-based coding
agent (supports Anthropic, OpenAI, DeepSeek, and Gemini) that a developer runs locally
against their own filesystem.

## Repo layout

| Directory        | What it is                                                            | Runtime      | Package manager |
|-------------------|------------------------------------------------------------------------|--------------|------------------|
| `api/`            | REST API — auth, projects, billing, credits, attachments, GitHub, the AI gateway, admin, webhooks | Bun + Express 5 | bun |
| `worker-service/` | Background worker — runs the agent loop in an E2B sandbox, talks to R2 | Bun          | bun |
| `deploy/`         | The economy build: `combined.ts` + the in-process bus + the SSE route  | Bun          | — (uses `api`/`worker-service`) |
| `web/`            | The user-facing SPA (chat, file tree, code editor, live preview, billing) | Vite + React 19 | pnpm |
| `mobile/`         | Native client (Expo/React Native) — a chat-first port of `web`         | Expo SDK 57  | npm |
| `cli/`            | `tau` — standalone multi-provider terminal coding agent                | Bun + Ink/React | bun |
| `ws-gateway/`     | **Legacy.** Redis-backed WebSocket gateway. Still builds; used only by the local four-service dev stack, not by the deployed path. | Bun | bun |
| `scripts/`        | One-off maintenance scripts (reset, secret remediation, E2B spikes)    | Bun          | — |
| `doc/`            | Internal design docs. Gitignored — local only.                        | — | — |

Note `mobile/` and `doc/` are both listed in the root `.gitignore`, so neither is
tracked in git. For `mobile/` that is a known problem, not a decision — see
`doc/OVERVIEW.md` issue #10.

`api`, `worker-service`, and `ws-gateway` share the same Postgres database and (in
the legacy split) Redis instance, and must all use the **same `ACCESS_TOKEN_SECRET`**
so that tokens minted by `api` verify correctly elsewhere.

## Getting started

### 1. Infrastructure

`api/docker-compose.yml` spins up Postgres 17 and Redis 7 for local development:

```bash
cd api
docker compose up -d
```

This exposes Postgres on `5432` (db `tau`, user/pass `tau`/`tau`) and Redis on `6379`,
matching the defaults in every `.env.example`. The economy build needs only Postgres.

### 2. Environment variables

- **Economy build:** one file, `deploy/.env` (copy `deploy/.env.example`). This
  is the authoritative list — it covers the api and the worker together, and
  `deploy/README.md` documents the gotchas that will otherwise cost you an hour
  (empty-string URL vars failing zod's `.url()` and exiting on boot; the R2 CORS
  rule attachments need; `KIMI_API_KEY` degrading silently rather than failing).
- **Legacy split:** each of `api`, `worker-service`, `ws-gateway` has its own
  `.env.example`. The `SHARED` block at the top of each (`DATABASE_URL`,
  `REDIS_URL`, `ACCESS_TOKEN_SECRET`) must match across all three.
- **web** needs an optional `VITE_API_URL` if the API isn't on the default host.
  `VITE_WS_URL` is gone — streaming rides the api origin over SSE.
- **mobile** needs `EXPO_PUBLIC_API_URL`. On a physical device that must be your
  machine's LAN IP, not `localhost`.

Migrations are **not** run automatically by the Docker image:

```bash
cd api && bunx prisma migrate deploy
```

### 3. Install and run

**Economy build** (what's deployed — one process):

```bash
bun run start:economy     # or: bun run dev:economy  (hot reload)
```

**Legacy four-service split** (what `dev.ps1` starts):

```bash
bun run dev               # web + api + ws-gateway + worker-service
```

All Bun-based services (`api`, `worker-service`, `ws-gateway`, `cli`) also run
standalone with the same pattern:

```bash
cd <service>
bun install
bun run generate   # api/ and worker-service/ only — Prisma, before first run
bun run dev
```

`web` uses pnpm and `mobile` uses npm — **do not cross them**:

```bash
cd web    && pnpm install && pnpm dev
cd mobile && npm install  && npm run android   # or: npm run ios
```

> `mobile` needs a **dev build**, not Expo Go — `react-native-mmkv` and
> `react-native-keyboard-controller` are native modules.

### 4. Run the CLI agent

```bash
cd cli
bun install
bun run tau        # or: bun run src/cli.ts
```

`tau` stores its own auth/config under `~/.tau/` rather than reading a `.env` at
runtime (the `cli/.env` in this repo is only for local development of the CLI itself).

## Common scripts

| Service           | dev              | build / typecheck                 | test        |
|-------------------|------------------|------------------------------------|-------------|
| `api`             | `bun run dev`    | `bun run build`, `bun run typecheck` | `bun test` (8 suites in `test/` + 3 colocated) |
| `worker-service`  | `bun run dev`    | `bun run typecheck`                | `bun test` (7 suites) |
| `ws-gateway`      | `bun run dev`    | `bun run typecheck`                | — |
| `web`             | `pnpm dev`       | `pnpm build`, `pnpm lint`           | — |
| `mobile`          | `npm start`      | `npm run typecheck`, `npm run lint` | `npm run check:parity` |
| `cli`             | `bun run dev`    | `bun run typecheck`                | `bun test` |

From the repo root:

| Script | What it does |
|---|---|
| `bun run dev` | the legacy four-service dev stack (`dev.ps1`) |
| `bun run start:economy` / `dev:economy` | the single-process build |
| `bun run check:mobile` | **wire-type parity + reachability + route census between `api`/`web` and `mobile`.** Run this after any change to `api/src/routes/*` — it is the only thing standing between the two clients and silent drift. See `mobile/AGENTS.md`. |
| `bun run reset` / `reset:confirm` | wipe local data |

There is **no CI** — nothing runs these automatically. That is the widest open
gap in the repo; see `doc/PRODUCTION_READINESS.md`.

## Operations

`GET /admin/ui` (behind `ADMIN_API_KEY`) is a server-rendered console: health,
1h/24h/7d metrics, an SSE firehose of live job phases, job/user/project/sandbox
drill-down, and kill-job / reconcile-stuck / release-holds actions. Start there
when a job looks wedged. Logs are one JSON object per line with `jobId` as a
correlation key (`api/src/lib/log.ts`).

## Further reading

`doc/` contains the internal design notes (not tracked in git, so only available
locally if you have them). **Start at `doc/OVERVIEW.md`** — architecture as
deployed, what's shipped, the open-issue table, and the roadmap. From there:
`AGENT_LOOP.md` for the deep agent reference, `interview_prep/` for a per-feature
walkthrough, `PRODUCTION_READINESS.md` for the operational gaps, and `archive/`
for the rationale behind decisions already made. Each subdirectory's own README
has more service-specific detail than this file.
