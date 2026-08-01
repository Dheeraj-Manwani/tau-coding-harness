# Economy single-process image: the whole backend in one Bun process, one port,
# no Redis. Deployable identically as a Render Docker web service or `docker run`
# on EC2. Only Postgres is required at runtime.
FROM oven/bun:1.3
WORKDIR /app

COPY . .

# One package, one lockfile, one node_modules, one Prisma client. This used to
# be two installs and two `prisma generate` runs, one per service.
RUN cd server && bun install --frozen-lockfile && bun run generate

ENV PORT=8080
EXPOSE 8080

CMD ["bun", "run", "server/src/index.ts"]
