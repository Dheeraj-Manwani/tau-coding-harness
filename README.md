# Tau

Tau is a "vibe coding" platform: a user describes what they want in a prompt, and Tau
scaffolds and iterates on a real web app for them inside a sandboxed environment,
streaming progress live to the browser. The repo also ships **tau-cli**, a standalone
multi-provider terminal coding agent that is independent of the web product.

This is a monorepo of independently deployable packages — there is no shared build
tool (no turborepo/nx/workspaces) tying them together. Each subdirectory is its own
project with its own dependencies and lockfile.

> **One backend, one process.** `server/` is the entire backend: the API, the job
> runner and the SSE stream all run in a single Bun process against Postgres.
> There is no Redis and no separate gateway. It used to be four services; see
> `doc/SERVICE_MERGE_PLAN.md` for how and why that changed.

## How a request flows through the system

```
 web (SPA)                         mobile (Expo)
   │  HTTP + EventSource             │  HTTP + react-native-sse
   └─────────────┬───────────────────┘
                 ▼
 server/src/index.ts ── one Bun process, one port ──► Postgres (Prisma)
   ├─ api routes            (server/src/api/index.ts)
   ├─ SSE stream + cancel   (server/src/sse-route.ts)
   ├─ in-process bus        (server/src/lib/bus.ts)
   └─ job runner            (server/src/worker startRunner)
                 │
                 ▼
        E2B sandbox — agent loop against Deepseek / Kimi,
        built files shipped to Cloudflare R2
```

1. A user signs in on `web` or `mobile` and submits a prompt.
2. `server/src/index.ts` validates it, persists the project in Postgres, and dispatches
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
| `server/`         | The whole backend in one package: REST API, job runner, SSE stream, in-process bus, Prisma schema and migrations. `src/api/` and `src/worker/` were separate services until they were merged; `src/lib/` is code shared by both. | Bun + Express 5 | bun |
| `web/`            | The user-facing SPA (chat, file tree, code editor, live preview, billing) | Vite + React 19 | pnpm |
| `mobile/`         | Native client (Expo/React Native) — a chat-first port of `web`         | Expo SDK 57  | npm |
| `cli/`            | `tau` — standalone multi-provider terminal coding agent                | Bun + Ink/React | bun |
| `test/`           | Repo-level checks that need no install (the api ↔ worker drift guard)  | Bun          | — |
| `doc/`            | Internal design docs. Gitignored — local only.                        | — | — |

Note `mobile/` and `doc/` are both listed in the root `.gitignore`, so neither is
tracked in git. For `mobile/` that is a known problem, not a decision — see
`doc/OVERVIEW.md` issue #10.

## Getting started

### 1. Infrastructure

`server/docker-compose.yml` spins up Postgres 17 for local development:

```bash
cd server
docker compose up -d
```

This exposes Postgres on `5432` (db `tau`, user/pass `tau`/`tau`), matching the
defaults in `server/.env.example`. Postgres is the only infrastructure required.

### 2. Environment variables

- **server** reads one file, `server/.env` (copy `server/.env.example`). It is
  the authoritative list, and `server/DEPLOY.md` documents the gotchas that will
  otherwise cost you an hour (empty-string URL vars failing zod's `.url()` and
  exiting on boot; the R2 CORS rule attachments need; `KIMI_API_KEY` degrading
  silently rather than failing).
- **web** needs an optional `VITE_API_URL` if the API isn't on the default host.
  `VITE_WS_URL` is gone — streaming rides the api origin over SSE.
- **mobile** needs `EXPO_PUBLIC_API_URL`. On a physical device that must be your
  machine's LAN IP, not `localhost`.

Migrations are **not** run automatically by the Docker image:

```bash
cd server && bunx prisma migrate deploy
```

The schema and migration history live in `server/prisma/`.

### 3. Install and run

The backend, one process:

```bash
bun run start:economy     # or: bun run dev:economy  (hot reload)
```

Or both the backend and the web SPA, each in its own terminal:

```bash
bun run dev               # web + server
```

`server` and `cli` run standalone with the same pattern:

```bash
cd server                  # or: cd cli
bun install
bun run generate           # server only — Prisma, before first run
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

| Package  | dev           | typecheck                           | test        |
|----------|---------------|-------------------------------------|-------------|
| `server` | `bun run dev` | `bun run typecheck`                 | `bun test` (23 suites, 335 tests) |
| `web`    | `pnpm dev`    | `pnpm build`, `pnpm lint`           | — |
| `mobile` | `npm start`   | `npm run typecheck`, `npm run lint` | `npm run check:parity` |
| `cli`    | `bun run dev` | `bun run typecheck`                 | `bun test` |

From the repo root:

| Script | What it does |
|---|---|
| `bun run dev` | web + server, each in its own terminal (`dev.ps1`) |
| `bun run start:economy` / `dev:economy` | the backend alone |
| `bun run test:drift` | the `src/api/` ↔ `src/worker/` drift guard. Needs no install |
| `bun run check:mobile` | **wire-type parity + reachability + route census between `server`/`web` and `mobile`.** Run this after any change to `server/src/api/routes/*` — it is the only thing standing between the two clients and silent drift. See `mobile/AGENTS.md`. |
| `bun run reset` / `reset:confirm` | wipe local data |

CI runs the typecheck, the test suite and the drift guard on every push and PR
(`.github/workflows/ci.yml`).

## Operations

`GET /admin/ui` (behind `ADMIN_API_KEY`) is a server-rendered console: health,
1h/24h/7d metrics, an SSE firehose of live job phases, job/user/project/sandbox
drill-down, and kill-job / reconcile-stuck / release-holds actions. Start there
when a job looks wedged. Logs are one JSON object per line with `jobId` as a
correlation key (`server/src/lib/log.ts`).

## Further reading

`doc/` contains the internal design notes (not tracked in git, so only available
locally if you have them). **Start at `doc/OVERVIEW.md`** — architecture as
deployed, what's shipped, the open-issue table, and the roadmap. From there:
`AGENT_LOOP.md` for the deep agent reference, `interview_prep/` for a per-feature
walkthrough, `PRODUCTION_READINESS.md` for the operational gaps, and `archive/`
for the rationale behind decisions already made. Each subdirectory's own README
has more service-specific detail than this file.
