# Economy single-process image: the whole backend in one Bun process, one port,
# no Redis. Deployable identically as a Render Docker web service or `docker run`
# on EC2. Only Postgres is required at runtime.
#
# Pinned to the patch version CI tests with (.github/workflows/ci.yml), so the
# image never runs a Bun the suite didn't.
FROM oven/bun:1.3.8
WORKDIR /app

# Only what the server needs. .dockerignore keeps web/, landing/, mobile/ and
# the rest out of the build context entirely.
COPY server ./server

# One package, one lockfile, one node_modules, one Prisma client. This used to
# be two installs and two `prisma generate` runs, one per service.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# `--with-deps` apt-installs Chromium's system libraries, so this step has to
# run as root; everything after it doesn't.
RUN cd server \
    && bun install --frozen-lockfile \
    && bun run generate \
    && bunx playwright install --with-deps chromium

# Chromium runs with --no-sandbox on pages from user-built apps. Doing that as
# root would hand any renderer escape the whole container; the image's
# unprivileged `bun` user limits it to a process that owns nothing.
USER bun

ENV NODE_ENV=production
ENV PORT=8080

# The commit this image was built from, shown in the ops console and tagged on
# error reports. Declared after the install layer so a new SHA never busts the
# dependency cache. Empty for local builds that don't pass it.
ARG GIT_SHA=""
ENV GIT_SHA=$GIT_SHA
EXPOSE 8080

# Bun is already in the image; no curl needed. /healthz pings the database and
# answers 503 while draining after SIGTERM.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["bun", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/healthz').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# Exec form so Bun is PID 1 and receives SIGTERM directly (graceful drain, see
# server/src/index.ts). Run the container with `--init` / compose `init: true`
# so Chromium's child processes are reaped.
CMD ["bun", "run", "server/src/index.ts"]
