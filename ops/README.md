# tau — production monitoring runbook

How tau is watched in production, how to set each piece up once, and where to look when
something is wrong. Design rationale and costs: `doc/ADMIN_CONSOLE.md`.

```
                      ┌──────────────── Better Stack ──── checks /healthz every 3 min from outside
                      │
 users ──▶ api.tauai.pro (EC2, one Bun process in Docker)
                      │   ├─ stdout JSON logs ──▶ Vector ──▶ Grafana Cloud Loki   (history, search)
                      │   ├─ exceptions ─────────────────▶ Sentry                (grouped, alerting)
                      │   └─ hourly sweep ─ alerts ──────▶ Discord               (stuck jobs, money)
                      │
 you ──▶ admin.tauai.pro (Vercel, static) ──▶ /admin/* (role-gated, cached)      (now, on demand)
```

| Question | Where |
|---|---|
| Is it up? | Better Stack (pages you) |
| What broke, with a stack trace? | Sentry (pages you on new issues) |
| Is something quietly wrong — stuck jobs, low DeepSeek balance, failed payments? | Discord, from the hourly sweep |
| What is happening right now? | admin.tauai.pro |
| What happened at 03:12 last Tuesday, for job X? | Grafana → Loki |

---

## One-time setup

Do these in order. Each one is independent and safe to do on a running box.

### 1. Log rotation (10 minutes — do this first)

An unrotated Docker log is the most common way a small box fills its disk. On the server:

```sh
cd /opt/tau
# from a checkout of this repo:
cp ops/docker-compose.monitoring.yml /opt/tau/
mkdir -p /opt/tau/vector
cp ops/vector/vector.yaml /opt/tau/vector/
printf 'COMPOSE_PATH_SEPARATOR=:\nCOMPOSE_FILE=docker-compose.yml:docker-compose.monitoring.yml\n' >> /opt/tau/.env
```

`COMPOSE_FILE` in `.env` makes every `docker compose` command in `/opt/tau` include the
override, including the ones the deploy workflow runs. The override gives `app` rotated logs
(5 × 10 MB). Rotation applies when the container is recreated, which the next deploy does.
To apply it now: `docker compose up -d app`.

Don't start the `vector` service until step 3. Until then, run `docker compose up -d app`
rather than a bare `up -d`.

Other containers on the box (Caddy, Postgres) can get the same default via
`/etc/docker/daemon.json`:
```json
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "5" } }
```
then `sudo systemctl restart docker`. That restarts every container, so do it in a quiet window.

### 2. Discord alerts (5 minutes)

1. Discord → your server → a `#tau-alerts` channel → Integrations → Webhooks → New → copy URL.
2. `/opt/tau/.env`: `ALERT_WEBHOOK_URL=https://discord.com/api/webhooks/…`
3. Optional: `DEEPSEEK_LOW_BALANCE=10` (default 5, in your DeepSeek account's currency).
4. Redeploy. The hourly sweep now posts here (rules below).

### 3. Logs → Grafana Cloud (15 minutes)

1. grafana.com → create a free stack → Loki → **Details**. Note the URL and the user id.
   Create an access-policy token with only the `logs:write` scope.
2. On the server:
   ```sh
   cp ops/vector/vector.env.example /opt/tau/vector/vector.env
   chmod 600 /opt/tau/vector/vector.env
   # fill in GRAFANA_LOKI_URL / _USER / _TOKEN
   docker compose up -d vector
   docker compose logs vector --tail 20      # expect no errors
   ```
3. Grafana → Explore → Loki → `{app="tau"}`: lines appear within a minute.

Vector reads Docker's log files read-only. It never touches the Docker socket. It is capped at
128 MB RAM and a quarter of a CPU, and it drops lines rather than filling the disk if Grafana is
unreachable. Successful fast requests (`http.request`) are sampled at 1 in 10. Errors, 5xx, requests
over 1 s, and every other event are kept in full.

Change the config locally first, then test it before copying it to the box:
```sh
vector test ops/vector/vector.yaml ops/vector/vector.test.yaml
```

### 4. Sentry (10 minutes)

1. sentry.io → new project → platform **Bun** → copy the DSN.
2. `/opt/tau/.env`: `SENTRY_DSN=https://…@….ingest.sentry.io/…` → redeploy.
3. Verify. This sends one test event from the running container:
   ```sh
   docker compose exec app bun -e 'const m = await import("/app/server/src/lib/log.ts"); await m.initErrorReporting(); m.createLogger("api").captureException(new Error("sentry wiring test")); await m.flushErrorReporting(5000);'
   ```
4. Sentry → Alerts → new issue alert: "A new issue is created" or "an issue regresses" →
   Discord (Settings → Integrations → Discord) or email.

What gets sent: the exception, the release (`GIT_SHA`), and tags (`svc`, `jobId`, `projectId`),
plus the user *id*. Request bodies, cookies and auth headers are stripped in `beforeSend`.
`prompt`/`content`/`password`/`token`-style fields read `[redacted]`. Credential query
params in any string are redacted. Performance tracing is off (`tracesSampleRate: 0`), so the free
quota is spent on errors only.

### 5. Uptime → Better Stack (10 minutes)

1. betterstack.com → Uptime → **Create monitor**:
   - `https://api.tauai.pro/healthz`, keyword must contain `"ok":true`, every 3 min.
     `/healthz` pings the database, so this catches "process up, DB down" too. It returns 503
     while a deploy drains, so set **confirmation period ≥ 2 min** to ride out a normal deploy.
   - `https://admin.tauai.pro`, expect 200, every 3 min.
2. Integrations → Discord → the same `#tau-alerts` channel.
3. Optional: a status page on `status.tauai.pro`.

### 6. Admin console → admin.tauai.pro

1. Vercel → Add project → this repo → **Root Directory `admin`**. The framework and commands come
   from `admin/vercel.json`. Env: `VITE_API_URL=https://api.tauai.pro`. The build refuses to run
   without it.
2. Domains → `admin.tauai.pro` → add the CNAME Vercel shows you.
3. `/opt/tau/.env`: `ADMIN_URL=https://admin.tauai.pro` → redeploy. This turns on the
   `/admin` CORS grant and `?client=admin` Google sign-in. Google Cloud Console needs no change.
4. Make yourself an admin: `UPDATE "User" SET role = 'ADMIN' WHERE email = '…';`
5. Sign in with Google at admin.tauai.pro.

`admin/vercel.json` sets the CSP (connect-src is pinned to `https://api.tauai.pro`). If the API
ever moves, change it there **and** in `VITE_API_URL`. Vercel skips the build when `admin/`
didn't change.

---

## What pages you

| Source | Fires on | Channel |
|---|---|---|
| Better Stack | `/healthz` down or not `"ok":true` for 2+ checks | Discord + phone |
| Sentry | new issue, or a resolved one regressing | Discord / email |
| Hourly sweep (`server/src/api/lib/alerts.ts`) | **critical:** stuck jobs · job failure rate > 10 % · sandbox provisioning failures > 5 % · DeepSeek balance low or unavailable · Razorpay webhook unprocessed > 10 min | Discord |
| | **warn:** leaked credit holds · tool failure rate > 10 % · p95 job > 15 min · credits/job doubled vs 24 h | Discord |

The rules live in `server/src/api/lib/anomalies.ts`, and the console uses the same functions. The
console also shows `info`-level findings and runtime signals the pager doesn't: event-loop lag,
memory, disk, 5xx rate, orphan E2B sandboxes, Kimi/Tavily quota. Those are in-process and reset
on deploy.

---

## Saved queries (Grafana → Explore → Loki)

```logql
# Everything for one job, end to end (api + worker + sandbox)
{app="tau"} | json | jobId = "<job id>"

# Exceptions, newest first
{app="tau", level="error"} | json | event = "exception"

# 5xx responses (never sampled)
{app="tau", svc="api"} | json | event = "http.request" | status >= 500

# Slow requests (never sampled)
{app="tau", svc="api"} | json | event = "http.request" | durationMs > 1000

# How jobs ended, last 24h
sum by (finishReason) (count_over_time({app="tau"} | json | event = "job.end" [24h]))

# Every alert the sweep raised
{app="tau"} | json | event = "alert"

# Who used the ops console, and for what (audit trail)
{app="tau"} | json | event = "admin.access"
```

---

## When something is wrong

| Symptom | Look at | Usually |
|---|---|---|
| "My project says a job is already running" | console → Users → user → holds | Release holds. If it's widespread, Tools → Reap stuck jobs |
| Builds failing across the board | console Overview → anomalies + Recent failures | DeepSeek balance, E2B outage, a bad template |
| DeepSeek low/unavailable alert | platform.deepseek.com | Top up. Builds resume immediately |
| Webhook backlog alert | console → Overview → Payment webhooks; Sentry for the exception | Fix the handler; Razorpay retries delivery |
| Orphan sandboxes | console → Sandboxes | Kill them (orphans only; owned sandboxes are refused) |
| Event-loop lag / memory pressure | console → Overview → Runtime; Loki for what ran at that time | A heavy request or a runaway job; kill it from Jobs |
| Box disk filling | `df -h`, `docker system df` | Check log rotation (step 1); `docker image prune -af` |
| Site down, nothing in Sentry | Better Stack + `docker compose ps` / `logs app --tail 200` | Process died or DB unreachable |
