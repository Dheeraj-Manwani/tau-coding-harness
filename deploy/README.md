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
- **Optional URL vars must be commented out, not left empty.** An empty string
  fails zod's `.url()` (which `.optional()` doesn't rescue) and the api exits on
  boot. Applies to `R2_PUBLIC_BASE_URL` and friends.
- **`KIMI_API_KEY` degrades silently, it doesn't fail loudly.** Without it, MAX
  effort quietly falls back to `DEEPSEEK_MODEL` and image/document attachments
  record a per-attachment extraction failure. Both services read the same key
  in combined mode. See `doc/PROMPT_ATTACHMENTS.md` and `doc/OVERVIEW.md`.
- **Attachments need an R2 CORS rule** allowing `PUT` from `APP_URL` — uploads
  go browser → R2 directly via presigned PUT. Without it the preflight 403s and
  every upload fails. Apply `deploy/r2-cors.json` (edit the origins first):

  ```
  Cloudflare dashboard → R2 → your bucket → Settings → CORS Policy → Edit
  ```

  `AllowedHeaders` must include `content-type`, since the client sends it as an
  unsigned header to set the stored object's type.
