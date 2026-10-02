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

Build from the **repo root** (the Dockerfile lives there and copies `server/`):

```sh
docker build -t tau-economy .
docker run --init --stop-timeout 60 -p 8080:8080 --env-file server/.env tau-economy
```

- **Render:** deploy as a Docker web service; set the env vars from
  `server/.env.example`; expose port 8080; health check path `/healthz`.
- **EC2:** `docker run` as above (add `-d --restart unless-stopped` for a daemon),
  or Docker Compose — see the service shape below.

Only a Postgres `DATABASE_URL` is required as external infra.

With Compose, the app service needs three settings the image can't carry:

```yaml
  app:
    image: ghcr.io/<you>/tau-server:${TAG:-latest}
    env_file: .env
    init: true               # reap Chromium's child processes (Bun is PID 1)
    stop_grace_period: 60s   # Docker's default is 10s; see "Shutdown" below
    restart: unless-stopped
```

### Health check

`GET /healthz` is unauthenticated: `200 {"ok":true}` when the process is up and
Postgres answers `SELECT 1` within 3s, `503` otherwise, and `503
{"reason":"draining"}` after SIGTERM. The image's `HEALTHCHECK` uses it; point
the proxy and any uptime monitor at it too. (`/admin/health` is the detailed,
admin-only view.)

### Behind a proxy

Set `TRUST_PROXY_HOPS` to the number of reverse proxies in front of the server —
`1` (the default) for Caddy, Nginx or Render; `2` if Cloudflare's orange cloud
sits in front of that; `0` if the port is exposed directly. Too low and every
user shares the proxy's rate-limit bucket; too high and clients can spoof their
IP with their own `X-Forwarded-For`.

### Shutdown

On SIGTERM the server stays up but stops starting jobs: prompts still waiting in
the queue (and any that arrive during the drain) are failed with a "tau is
restarting" message and their credit holds released; jobs already running get
`SHUTDOWN_GRACE_MS` (default 50s) to finish, then the process exits. Anything
still running at the deadline is reaped on next boot. Keep the grace period
below the container stop timeout (`stop_grace_period` / `--stop-timeout` /
systemd `TimeoutStopSec`), or the process is SIGKILLed mid-drain.

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
interactive SSH session. Set `TimeoutStopSec=60` in the unit so a restart waits
for the graceful drain (see "Shutdown" above). Keep secrets in `server/.env` with mode `0600`, or use
an external systemd `EnvironmentFile`; never commit them. Put Nginx or an AWS
Application Load Balancer in front for TLS and health checks.

Repository files on disk do not normally consume application RAM. Sparse
checkout mainly reduces disk use, clone/pull work, and accidental build/watch
scope. Runtime memory is controlled by the Bun process, Chromium/Playwright,
request concurrency, and the in-process job queue.

## Web and landing

The authenticated web SPA is built/hosted at `app.tauai.pro`. Point it at the
single API origin and the public site:

```
VITE_API_URL=https://<host>
VITE_LANDING_URL=https://tauai.pro
```

Set backend `APP_URL=https://app.tauai.pro` and
`OAUTH_SUCCESS_REDIRECT=https://app.tauai.pro/auth/callback`.

Live streaming now rides the api origin over SSE, so **`VITE_WS_URL` is gone**.

### Hosting on Vercel

Two Vercel projects from this repo, one per app: Root Directory `web` (domain
`app.tauai.pro`) and Root Directory `landing` (domain `tauai.pro`). Each has a
`vercel.json` that:

- rewrites every path with no matching file to `/index.html`, so refreshing a
  client route like `/project/123` doesn't 404. Real files, including the
  prerendered `dist/<route>/index.html` pages, are served first;
- caches the content-hashed `/assets/*` for a year.

Set the `VITE_*` variables above as Vercel environment variables. They're read
at **build** time, so changing one needs a redeploy.

- **Use the custom domain, never `*.vercel.app`, for the web app.** The refresh
  cookie is `SameSite=Strict`, which works only because `app.tauai.pro` and
  `api.tauai.pro` are the same site. From a `vercel.app` origin, login refresh
  breaks, and CORS rejects it anyway, since the API allows only `APP_URL`.
  Preview deployments of `web` can therefore render but can't sign in.
- **Landing prerender:** Vercel's own build runs `pnpm build` only, which ships
  a working SPA with no prerendered HTML. The prerender step needs Playwright's
  Chromium and its system libraries, which Vercel's build image isn't set up
  for. To ship prerendered pages, build in GitHub Actions instead: install
  Chromium with `npx playwright install --with-deps chromium`, run `vercel
  build` with the build command set to `pnpm build && node
  scripts/prerender.ts` (so the prerender runs before Vercel copies
  `dist/`), then `vercel deploy --prebuilt --prod`.

### Build order

`vite build` alone ships a client-only SPA: the landing page and all doc
pages are an empty `<div id="root">` to any crawler that doesn't run JS. Two
steps around it fix that.

```bash
# 1. Nav tree + ⌘K search index + public/sitemap.xml.
#    Already wired into landing/'s predev and prebuild — listed for completeness.
bun run docs:index

# 2. Build both deployable packages.
cd landing && pnpm build && cd ..
cd web && pnpm build && cd ..

# 3. Static HTML per public route, written over dist/<route>/index.html.
#    Node, not bun: playwright's CDP pipe transport doesn't complete its
#    handshake under bun on Windows (the browser launches, then times out).
node landing/scripts/prerender.ts
```

Notes:

- **Set `SITE_ORIGIN`** for anything other than production. Both the sitemap and
  the prerendered `<link rel="canonical">` / `og:url` are written against it, and
  it defaults to `https://tauai.pro`.
- **Prerender needs fresh build output.** It refuses to run over an already
  prerendered `dist/` rather than rendering each route on top of the previous
  run's markup. Rebuild between runs.
- **A partial prerender exits non-zero.** Routes that failed still ship as empty
  shells, so a half-prerendered deploy must fail the build rather than pass
  quietly.
- **Chromium must be installed**: `npx playwright install chromium`.
- The public routes live in `landing/scripts/public-routes.ts`; doc routes come from the
  generated index, so neither list can drift from the content tree.

## Notes / tradeoffs

- **No job durability:** the runner is pure in-memory. A graceful restart
  (SIGTERM) lets running jobs finish within `SHUTDOWN_GRACE_MS` and fails queued
  ones cleanly; a crash or SIGKILL drops them, and the boot-time reaper marks
  the orphaned rows failed. Deploy at quiet times.
- **Single instance only:** the in-process bus and job queue don't span
  replicas, so there is no zero-downtime rolling deploy.
- **Email and Google sign-in are optional.** Without `RESEND_API_KEY`,
  verification and confirmation-code emails fail with a 503; without both
  `GOOGLE_CLIENT_*` values, `/auth/google` returns 404. The server boots either way.
- **Optional vars must be commented out, not left empty.** An empty string
  is not "unset": it fails zod's `.url()` (which `.optional()` doesn't rescue)
  and the server exits on boot. `.env.example` ships every optional value
  commented out for this reason.
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

The Docker image does **not** run migrations. Apply them explicitly, with the
new image, before starting it — on the first deploy and after every schema
change. The image carries the Prisma CLI, the schema and the migrations:

```sh
# plain Docker
docker run --rm --env-file server/.env tau-economy \
  sh -c "cd server && bunx prisma migrate deploy"

# Compose (service named `app`, as above)
docker compose run --rm app sh -c "cd server && bunx prisma migrate deploy"
```

Without Docker, run `bunx prisma migrate deploy` from `server/`.

There is one schema and one migration history, at `server/prisma/`, read via
`server/prisma.config.ts`; a single `prisma generate` builds the client.

## Admin

The operations console is the separate `admin/` app (admin.tauai.pro), reading
the role-gated `/admin/*` JSON endpoints here. Set `ADMIN_URL` to its origin:
that grants it CORS on `/admin` and enables its Google sign-in. Runbook:
`ops/README.md`.

Access is `User.role === ADMIN` and nothing else — there is no admin key, and
the role is re-read from the database on every request, so revoking someone
takes effect immediately. The console signs in with Google only
(`/auth/google?client=admin`), which sets an `/admin`-scoped cookie; scripts can
send `Authorization: Bearer <access token>`. There is no password login for
admin. Promote the first operator by hand after the first deploy:

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
