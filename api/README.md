# api

The REST API: auth, projects, messages, credits & billing, attachments, GitHub,
the AI gateway, and the admin console. Bun + Express 5 + Prisma/Postgres.

> **In production this does not run standalone.** `deploy/combined.ts` mounts
> these routes alongside the SSE stream and the job runner in a single Bun
> process (`bun run start:economy` from the repo root). Running `api` on its own
> is for local development against the four-service split (`dev.ps1`), where
> `ws-gateway` and `worker-service` are separate processes and Redis is present.

## Setup

```bash
bun install
bun run generate          # prisma generate — required before first run
bun run migrate           # prisma migrate dev  (deploys use `prisma migrate deploy`)
bun run dev               # hot-reloading server on PORT
```

Copy `.env.example` to `.env` first. The `SHARED` block at the top
(`DATABASE_URL`, `REDIS_URL`, `ACCESS_TOKEN_SECRET`) must be **identical** across
`api`, `worker-service`, and `ws-gateway` — tokens minted here are verified
there. For the economy build the single `deploy/.env` supersedes all of them.

`api/docker-compose.yml` brings up Postgres 17 + Redis 7 matching those defaults.

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
best covered. **Nothing runs these automatically; there is no CI.**

## Notes

- `pricing.ts`, `credits.ts`, `github.ts`, `s3.ts`, `log.ts` and ~9 other leaf
  libs are **duplicated** in `worker-service/src/lib/`, as are the Prisma schema
  and the generated client. Changing one without the other is the standing drift
  risk in this repo (`doc/OVERVIEW.md` #7). The `pricing.test.ts` in each service
  is a drift guard for the one case where drift was actually costly.
- See `doc/interview_prep/06-authentication.md` and `07-credits-and-billing.md`
  for the reasoning behind the auth and credit models.
