# Economy deployment (single process, no Redis)

Runs `api` + `worker-service` + the SSE event stream in **one Bun process on one
port**, backed only by **Postgres**. No Redis, no separate ws-gateway. See
`doc/economy-deployment.md` for the design and `doc/economy-implementation-plan.md`
for the build log.

## Local run

```sh
cp deploy/.env.example deploy/.env   # fill in real values
bun run start:economy                # or: bun run dev:economy  (hot reload)
```

Serves HTTP + SSE on `PORT` (default 8080):
- api routes at `/…`
- live job stream: `GET /jobs/:jobId/stream?token=<access>&lastEventIndex=<n>` (SSE)
- cancel a job: `POST /jobs/:jobId/cancel` (Bearer auth)

## Docker (Render or EC2 — same image)

```sh
docker build -t tau-economy .
docker run -p 8080:8080 --env-file deploy/.env tau-economy
```

- **Render:** deploy as a Docker web service; set the env vars from
  `deploy/.env.example`; expose port 8080.
- **EC2:** `docker run` as above (add `-d --restart unless-stopped` for a daemon).

Only a Postgres `DATABASE_URL` is required as external infra.

## Web

The web SPA is still built/hosted separately. Point it at the single origin:

```
VITE_API_URL=https://<host>
```

Live streaming now rides the api origin over SSE, so **`VITE_WS_URL` is gone**.

## Notes / tradeoffs

- **No job durability:** the runner is pure in-memory; a process restart drops
  queued/in-flight jobs (rows stay `QUEUED`/`RUNNING`, user re-submits).
- **Single instance only:** the in-process bus doesn't span replicas. For
  horizontal scale, use the Redis-based `master` build instead.
- **Boot-required env:** `RESEND_API_KEY`, `GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET` are constructed at import and must be set (even though
  the schema marks them optional).
