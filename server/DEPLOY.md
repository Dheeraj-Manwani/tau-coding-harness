# Economy deployment (single process, no Redis)

Runs `api` + `worker-service` + the SSE event stream in **one Bun process on one
port**, backed only by **Postgres**. No Redis, no separate ws-gateway. See
`doc/archive/economy-deployment.md` for the design and
`doc/archive/economy-implementation-plan.md` for the build log.

Serves both clients: `web/` (SPA, hosted separately) and `mobile/` (Expo).

## Local run

```sh
cp server/.env.example server/.env   # fill in real values
bun run start:economy                # or: bun run dev:economy  (hot reload)
```

Serves HTTP + SSE on `PORT` (default 8080):
- api routes at `/…`
- live job stream: `GET /jobs/:jobId/stream?token=<access>&lastEventIndex=<n>` (SSE)
- cancel a job: `POST /jobs/:jobId/cancel` (Bearer auth)

## Docker (Render or EC2 — same image)

```sh
docker build -t tau-economy .
docker run -p 8080:8080 --env-file server/.env tau-economy
```

- **Render:** deploy as a Docker web service; set the env vars from
  `server/.env.example`; expose port 8080.
- **EC2:** `docker run` as above (add `-d --restart unless-stopped` for a daemon).

Only a Postgres `DATABASE_URL` is required as external infra.

## EC2 without Docker (server-only checkout)

Prefer Git sparse-checkout over deleting tracked files. It keeps the deployment
checkout clean, so future pulls work normally, while only `server/` is present
in the working tree.

After the first clone:

```sh
cd tau
bash server/scripts/ec2-server-only.sh --prune-untracked
cd server
bun install --frozen-lockfile
bun run generate
bunx playwright install --with-deps chromium
bunx prisma migrate deploy
```

For later releases, the sparse-checkout setting is already persistent:

```sh
cd /opt/tau
git pull --ff-only
cd server
bun install --frozen-lockfile
bun run generate
bunx prisma migrate deploy
sudo systemctl restart tau
```

Run `bun run start` under systemd (or another process supervisor), not in an
interactive SSH session. Keep secrets in `server/.env` with mode `0600`, or use
an external systemd `EnvironmentFile`; never commit them. Put Nginx or an AWS
Application Load Balancer in front for TLS and health checks.

Repository files on disk do not normally consume application RAM. Sparse
checkout mainly reduces disk use, clone/pull work, and accidental build/watch
scope. Runtime memory is controlled by the Bun process, Chromium/Playwright,
request concurrency, and the in-process job queue.

## Web

The web SPA is still built/hosted separately. Point it at the single origin:

```
VITE_API_URL=https://<host>
```

Live streaming now rides the api origin over SSE, so **`VITE_WS_URL` is gone**.

### Build order

`vite build` alone ships a client-only SPA: the landing page and all 41 doc
pages are an empty `<div id="root">` to any crawler that doesn't run JS. Two
steps around it fix that.

```bash
# 1. Nav tree + ⌘K search index + public/sitemap.xml.
#    Already wired into web/'s predev and prebuild — listed for completeness.
bun run docs:index

# 2. Build.
cd web && pnpm build && cd ..

# 3. Static HTML per public route, written over dist/<route>/index.html.
#    Node, not bun: playwright's CDP pipe transport doesn't complete its
#    handshake under bun on Windows (the browser launches, then times out).
node scripts/prerender.ts
```

Notes:

- **Set `SITE_ORIGIN`** for anything other than production. Both the sitemap and
  the prerendered `<link rel="canonical">` / `og:url` are written against it, and
  it defaults to `https://usetau.dev`.
- **Prerender needs fresh build output.** It refuses to run over an already
  prerendered `dist/` rather than rendering each route on top of the previous
  run's markup. Rebuild between runs.
- **A partial prerender exits non-zero.** Routes that failed still ship as empty
  shells, so a half-prerendered deploy must fail the build rather than pass
  quietly.
- **Chromium must be installed**: `npx playwright install chromium`.
- The public routes live in `scripts/public-routes.ts`; doc routes come from the
  generated index, so neither list can drift from the content tree.

## Notes / tradeoffs

- **No job durability:** the runner is pure in-memory; a process restart drops
  queued/in-flight jobs (rows stay `QUEUED`/`RUNNING`, user re-submits).
- **Single instance only:** the in-process bus doesn't span replicas. For
  horizontal scale, use the Redis-based `master` build instead.
- **Boot-required env:** `RESEND_API_KEY`, `GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET` are constructed at import and must be set (even though
  the schema marks them optional).
- **Optional URL vars must be commented out, not left empty.** An empty string
  fails zod's `.url()` (which `.optional()` doesn't rescue) and the api exits on
  boot. Applies to `R2_PUBLIC_BASE_URL` and friends.
- **`KIMI_API_KEY` degrades silently, it doesn't fail loudly.** Without it, MAX
  effort quietly falls back to `DEEPSEEK_MODEL` and image/document attachments
  record a per-attachment extraction failure. Both services read the same key
  in combined mode. See `doc/interview_prep/12-attachments.md` and
  `doc/OVERVIEW.md`.
- **`TAU_KEY_ENC_SECRET` is required once the AI gateway is in use.** It is the
  AES-256-GCM key that `tau_sk_*` API keys are encrypted under at rest. Losing
  or changing it makes every existing key undecryptable — every deployed
  generated app breaks and every user must rotate. Back it up separately from
  the database; the two together are what an attacker needs.
- **`TAU_AI_URL` must be publicly reachable from inside an E2B sandbox**, not
  just from your laptop. It is injected into generated apps as the gateway
  origin. A `localhost` or LAN value makes `enable_ai` produce apps that fail at
  runtime — the reachability check refuses loudly rather than shipping a broken
  app, but only if the value is wrong in a way it can detect. See
  `doc/AI_FOR_GENERATED_APPS.md` §9.
- **Mobile OAuth needs the `tau://` deep link registered** and the one-shot
  handoff endpoints reachable (`POST /auth/github/prepare`,
  `POST /auth/google/exchange`). Refresh tokens are never put in a URL; see
  `server/src/api/lib/handoff.ts`.

## Migrations

The Docker image does **not** run migrations. Apply them explicitly before the
first boot of a new deploy and after every schema change:

```sh
docker compose run --rm app sh -c "cd server && bunx prisma migrate deploy"
```

There is one schema and one migration history, at `prisma/` in the repo root.
`cd api` only picks an installed Prisma CLI — both services' `prisma.config.ts`
point at the same shared files, so it does not matter which one you run this
from. The image builds both clients from that schema with a single
`prisma generate`.

## Admin

`GET /admin/ui` is a server-rendered operations console: health, 1h/24h/7d
metrics, an SSE firehose of live job phases, job/user/project/sandbox
drill-down, and kill-job / reconcile-stuck / release-holds actions. Start here
when a job looks wedged.

Access is `User.role === ADMIN` and nothing else — there is no admin key, and
the role is re-read from the database on every request, so revoking someone
takes effect immediately. Sign in with that account's email and password, or
with an `Authorization: Bearer <access token>` for scripts and OAuth-only
accounts. Promote the first operator by hand after the first deploy:

```sql
UPDATE "User" SET role = 'ADMIN' WHERE email = 'you@example.com';
```

There is no bootstrap script and no break-glass credential: if you lose every
admin account, the only way back in is this statement against the database.
- **Attachments need an R2 CORS rule** allowing `PUT` from `APP_URL` — uploads
  go browser → R2 directly via presigned PUT. Without it the preflight 403s and
  every upload fails. Apply `server/r2-cors.json` (edit the origins first):

  ```
  Cloudflare dashboard → R2 → your bucket → Settings → CORS Policy → Edit
  ```

  `AllowedHeaders` must include `content-type`, since the client sends it as an
  unsigned header to set the stored object's type.
