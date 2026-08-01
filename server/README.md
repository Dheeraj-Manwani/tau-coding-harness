# server

The entire backend in one Bun package: the REST API (auth, projects, messages,
credits & billing, attachments, GitHub, the AI gateway, the admin console), the
job runner that drives the agent loop, and the SSE stream that carries events to
the clients. Bun + Express 5 + Prisma/Postgres.

`src/index.ts` starts all of it in a **single process on a single port**. There
is no Redis and no separate gateway.

| Path | What lives there |
|---|---|
| `src/api/` | REST routes, services, middleware — the former `api` service |
| `src/worker/` | The agent loop, tools, templates — the former `worker-service` |
| `src/lib/` | Code shared by both: the in-process bus, the logger, pricing |
| `src/generated/` | The single generated Prisma client (`@/generated/prisma/*`) |
| `prisma/` | The one schema and migration history |
| `scripts/` | Operational tools (reset, secret remediation) and template builds |
| `test/` | `api/` and `worker/` suites, plus 4 colocated in `src/api/lib/` |

Imports use the `@/*` alias, which maps to `src/*`.

## Setup

```bash
bun install
bun run generate          # prisma generate — required before first run
bun run migrate           # prisma migrate dev  (deploys use `prisma migrate deploy`)
bun run dev               # hot-reloading server on PORT
```

Copy `.env.example` to `.env` first — it is the single authoritative list for
the whole backend. `docker-compose.yml` brings up Postgres 17 matching those
defaults.

## Layout

```
src/
  routes/        one file per resource; mounted in index.ts
  controllers/   HTTP shape only — parse, delegate, respond
  services/      business logic
  repositories/  Prisma access
  middleware/    auth, apiKey, admin, rateLimit, logger, error
  schemas/       zod request validation
  lib/           credits, pricing, tokens, s3, github, apiKeys, handoff, log, alerts, …
  views/         adminConsole.ts — the server-rendered /admin/ui
  generated/     prisma client (checked in; regenerate with `bun run generate`)
```

## Route groups

| Prefix | What |
|---|---|
| `/auth` | register/login/refresh/logout, email verification, Google + GitHub OAuth. Mobile has its own path on both OAuth flows via the one-shot tokens in `lib/handoff.ts` — it has no cookie jar. |
| `/project` | project CRUD, messages, files, preview, cancel-all, per-project GitHub |
| `/credits`, `/billing` | balance, ledger, spend split, packs, subscriptions, promo codes |
| `/attachments` | presigned R2 upload → extraction → `READY` |
| `/account` | API-key lifecycle (`get`/`create`/`reveal`/`rotate`/`revoke`/`cap`) and re-auth. **Reveal and rotate hand out a live spend credential, so a valid session is deliberately not sufficient** — they require a fresh `X-Tau-Reauth` token. |
| `/ai`, `/v1` | the AI gateway generated apps call. `/ai` is plain `fetch`; `/v1` is OpenAI-compatible. Authenticated by `tau_sk_*` key, not by session. |
| `/admin` | health, metrics, job/user/sandbox drill-down, kill/reconcile/release, `/admin/ui` |
| `/webhook` | Razorpay, idempotent via `WebhookEvent` |

## Tests

```bash
bun test
```

11 suites: 8 in `test/` (`gateway`, `github`, `githubHandoff`, `googleMobileOAuth`,
`pricing`, `projectFiles`, `reauth`, `secretPaths`) plus 3 colocated in `src/lib/`.
The security-sensitive paths — re-auth, handoff tokens, secret redaction — are the
best covered. CI runs them on every push and PR (`.github/workflows/ci.yml`).

## Notes

- 13 leaf libs are still **duplicated** between `src/api/lib/` and
  `src/worker/lib/` — `credits.ts`, `github.ts`, `s3.ts`, `env.ts` and friends.
  The Prisma schema and generated client are no longer among them. Changing one
  copy without the other is the standing drift risk here, and
  `test/drift.test.ts` at the repo root now fails the build when it happens.
  See `doc/SERVICE_MERGE_PLAN.md` phase 4 for the plan to finish deduping them.
- See `doc/interview_prep/06-authentication.md` and `07-credits-and-billing.md`
  for the reasoning behind the auth and credit models.
