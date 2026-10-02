# tau ops (admin console)

The production console at `admin.tauai.pro`. It's a static Vite + React app with no server of
its own. Every number comes from the API's role-gated `/admin/*` endpoints. The plan and
design rationale are in `doc/ADMIN_CONSOLE.md`.

**Load contract:** nothing here polls. Every page fetches once when it opens. Refresh, or
reloading the page, is the only way to get newer data. The server caches the overview
for 30 s, and provider checks for 5 minutes.

## Run locally

```sh
pnpm install
cp .env.example .env        # VITE_API_URL=http://localhost:8080
pnpm dev                    # http://localhost:5175
```

The server needs `ADMIN_URL=http://localhost:5175` (CORS on `/admin` + Google sign-in),
and your account must be an admin:

```sql
UPDATE "User" SET role = 'ADMIN' WHERE email = 'you@example.com';
```

Sign-in is Google only. The button goes to `${VITE_API_URL}/auth/google?client=admin`. The
server checks the role, sets an HttpOnly `/admin`-scoped cookie, and redirects back here.
This app never handles a token.

## Scripts

| | |
|---|---|
| `pnpm dev` | dev server on :5175 |
| `pnpm build` | typecheck + production build to `dist/` |
| `pnpm typecheck` | `tsc -b` only |
| `pnpm lint` | oxlint |

## Layout

```
src/
  lib/api.ts        fetch wrapper: credentials, 401/403 → sign-in
  lib/useApi.ts     fetch-once hook (no polling, no refetch-on-focus)
  lib/format.ts     numbers, durations, money, relative time
  types.ts          response shapes, mirrored by hand from the server
  auth.tsx          session probe (/admin/me) + sign out
  components/       ui primitives, Sparkline, ErrorBoundary, icons
  pages/            one file per route
```

`types.ts` mirrors `server/src/api/services/admin*.service.ts` by hand on purpose. The
console shares no code with the server, so it keeps building and working whatever state
the server tree is in. Update both together when you change a response.
