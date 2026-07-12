# Economy single-process image: api + worker + SSE in one Bun process, one port,
# no Redis. Deployable identically as a Render Docker web service or `docker run`
# on EC2. Only Postgres is required at runtime.
FROM oven/bun:1.3
WORKDIR /app

COPY . .

# Each service keeps its own lockfile + node_modules and its own Prisma client.
# ws-gateway is intentionally not installed — the economy build doesn't import it.
RUN cd api && bun install --frozen-lockfile && bun run generate \
 && cd ../worker-service && bun install --frozen-lockfile && bun run generate

ENV PORT=8080
EXPOSE 8080

CMD ["bun", "run", "deploy/combined.ts"]
