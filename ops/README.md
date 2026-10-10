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
| | **warn:** leaked credit holds · tool failure rate > 10 % · p95 job > 15 min · credits/job doubled vs 24 h · one project creating 500+ stored files in an hour · stored files past 8 GB in total (`STORAGE_UPLOAD_SPIKE_PER_HOUR`, `STORAGE_ALERT_BYTES`) | Discord |

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
| Storage upload-spike or bucket-size alert | console → Storage; the project's page → File storage | Look at the files; suspend the project's storage if it is abuse (see File storage below) |

---

## File storage (Tau Cloud Storage)

Generated apps keep files in a separate R2 bucket (`R2_STORAGE_BUCKET`, `tau-app-storage`) through
signed addresses; tau's database (`StorageObject`) is the list of files. Design: `doc/TAU_CLOUD_STORAGE.md`.
The bucket has an open CORS policy (any origin may `PUT`, `GET`, `HEAD`) because uploads come from
preview hosts and owners' domains; the main bucket is not opened like that.

### Suspend a project's storage

Console → Projects → the project → **File storage → Suspend storage**. A reason is required and goes
to the log (`admin.storage.suspend`, with the admin's id). Effect, within seconds: the app's key gets
`storage_suspended` (403) on every call, the owner's Storage pane says so and cannot open files.
**Every file is kept.** **Resume storage** puts it back. Suspending a published site
(**Suspend site**) suspends its storage with it, and lifting the site lifts the storage; to keep storage
stopped after lifting a site, suspend it again.

### Answer a takedown report

1. Find the project: the reported address gives the site, console → Users or the Storage page's
   *Largest projects* gives the project.
2. **Suspend storage** first if the content is harmful (a reason such as the report's date). This
   stops new downloads at once; signed addresses already handed out last up to an hour.
3. Project page → **File storage → Show files** (pick Preview or Live), find the file, **Delete** with
   a reason. This removes the row and the bytes (log line `admin.storage.delete_file`).
4. Decide about the owner: resume storage, or leave it suspended and tell them why.
5. Check the log for who did what: `{app="tau"} |= "admin.storage"` in Loki.

Files are served as downloads unless they are pictures, PDF, audio, video or plain text, and HTML and
SVG are never shown in place, so a file cannot run code in an app's origin or in tau's.

### Reconcile the bucket with the table

```sh
cd server
bun run scripts/reconcile-storage.ts          # report: objects with no row, READY rows with no object
bun run scripts/reconcile-storage.ts --fix    # delete the stray objects and the dead rows
```

Run the report after any incident or bucket change; a healthy system reports nothing. Needs
`R2_STORAGE_BUCKET` and the database settings. Stray objects cost money and no one can reach them;
dead rows show the owner a file that will not open.

### Settings

`R2_STORAGE_BUCKET` (storage is off without it), `R2_STORAGE_ACCESS_KEY_ID` and `_SECRET_ACCESS_KEY`
(a token limited to the bucket; falls back to the main R2 pair), `TAU_STORAGE_URL` (the public address of
`/storage`, as for `TAU_AI_URL`), `STORAGE_RPM`, `STORAGE_UPLOAD_TTL_SECONDS`, `STORAGE_URL_TTL_SECONDS`,
`STORAGE_PENDING_TTL_MS`, `STORAGE_ALERT_BYTES`, `STORAGE_UPLOAD_SPIKE_PER_HOUR`. The allowances per
plan are constants in `server/src/lib/pricing.ts`.

### Terms and the abuse contact

Done 2026-10-10. `landing/src/pages/Terms.tsx` (effective October 10, 2026) has the strict acceptable-use
list (section 6), the rules for published apps and stored files (7), reporting and takedown (8),
enforcement (9) and indemnity (10). The only contact for reports is the marketing address
(`CONTACT_EMAIL` in `Terms.tsx`, the site footer and `help/contact.md`), so **that mailbox is the abuse
inbox**: a report there is a takedown request, and the steps above are how to answer it. If the address
ever changes, change it in `Terms.tsx`, `Privacy.tsx`, `SiteFooter.tsx`, `help/contact.md`,
`DocsIndex.tsx` and `ship/storage.md`. The terms are a draft written without a lawyer; have counsel read
them before relying on them in a dispute.
