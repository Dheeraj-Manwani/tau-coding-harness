# Backend guide — Hono on Bun

The app has a server: `server/index.ts`, a Hono app that Bun serves on port 3000.

## How it is wired
- The frontend reaches it at `/api/*`. Vite (:5173) proxies those paths to Hono (:3000), so the frontend always fetches a **relative** URL — `fetch('/api/things')`, never `localhost:3000`.
- The server is already running and restarts itself whenever you save a file under `server/`. Never start or restart it yourself.
- Its output is in `.tau/logs/server.log`. Read that first when a route misbehaves.
- Test a route from the sandbox with `curl -s http://localhost:3000/api/health`.

## Rules
- Add routes to the existing `app` in `server/index.ts`. Do NOT create a second Hono instance and do NOT call `app.listen` — Bun serves the file's `export default { port: 3000, fetch: app.fetch }`.
- Keep the `GET /api/health` route. tau uses it to tell that the server is up.
- Every route path starts with `/api/`. Anything else never reaches the server.
- Secrets live on the server only. Read them with `process.env.NAME` inside a route; never send one to the browser.

## Hono cheat-sheet
- Route + handler: `app.get('/api/things', (c) => c.json([...]))`
- Route param: `c.req.param('id')` — for `/api/things/:id`
- Query string: `c.req.query('q')` (undefined if absent)
- JSON body (POST/PUT): `const body = await c.req.json<{ x: string }>()`
- Respond with a status: `c.json({ error: '...' }, 400)` (default 200)
- Text / redirect: `c.text('ok')`, `c.redirect('/api/health')`
- `server/index.ts` starts out with worked example routes. Replace them with the app's real ones.

## On the frontend
Call the API through React Query, which is already set up:

```tsx
const { data } = useQuery({
  queryKey: ['things'],
  queryFn: () => fetch('/api/things').then((r) => r.json()),
})
```

## What this does not give you
No database. Data held in a server variable is lost on every restart. If the app must store data on the server, call `add_database`.
