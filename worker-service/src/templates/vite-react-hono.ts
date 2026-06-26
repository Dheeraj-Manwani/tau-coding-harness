import { Template, waitForPort } from "e2b";

const APP = "/home/user/app";

export const template = Template()
  .fromBunImage("1.3")
  .setWorkdir(APP)

  // 1) Scaffold Vite React-TS directly into the workdir
  .runCmd("bun create vite@latest . --template react-ts")
  .runCmd("bun install")

  // 1b) Drop the scaffold's demo assets (public/vite.svg, src/assets/react.svg)
  .runCmd("rm -rf public/* src/assets src/App.css")
  .runCmd(
    `cat > src/App.tsx <<'EOF'
function App() {
  return (
    <div className="flex min-h-svh items-center justify-center">
      <h1 className="text-2xl font-bold">App ready</h1>
    </div>
  )
}

export default App
EOF`,
  )
  .runCmd("sed -i '/vite.svg/d' index.html")
  // Default the app to dark mode (Spotify-style). The theme itself is written
  // into src/index.css after shadcn init below.
  .runCmd(
    `sed -i 's/<html lang="en">/<html lang="en" class="dark">/' index.html`,
  )

  // 2) git init so snapshots can use `git ls-files` (auto-respects .gitignore)
  //    and you get history for free. The Vite scaffold already ignores
  //    node_modules/dist; we make sure secrets are ignored too.
  .runCmd("git init -q")
  .runCmd("printf '\\n.env\\n.env.*\\n' >> .gitignore")

  // 3) Tailwind v4 (Vite plugin) + shadcn runtime deps.
  .runCmd("bun add -d tailwindcss @tailwindcss/vite")
  .runCmd(
    "bun add class-variance-authority clsx tailwind-merge lucide-react tw-animate-css",
  )

  // 4) Hono API. On Bun you serve the app via the default export — no adapter.
  .runCmd("bun add hono")

  // 5) Wire Tailwind + the `@/*` path alias that shadcn requires.
  .runCmd(
    `cat > src/index.css <<'EOF'
@import "tailwindcss";
@import "tw-animate-css";
EOF`,
  )
  .runCmd(
    `cat > vite.config.ts <<'EOF'
import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: {
    host: true,            // bind 0.0.0.0 so E2B can forward the preview port
    port: 5173,
    // Vite blocks requests whose Host header isn't whitelisted. The E2B preview
    // domain is dynamic (5173-<sandboxId>.e2b.app), so allow the whole suffix —
    // without this you get a 403 'host not allowed' page even though Vite is up.
    allowedHosts: ['.e2b.app'],
    proxy: { '/api': 'http://localhost:3000' }, // forward API calls to Hono
  },
})
EOF`,
  )
  // shadcn reads the alias from tsconfig; add it to both files the Vite
  // template generates. (If `shadcn init` ever errors, the alias is the cause.)
  .runCmd(
    `cat > tsconfig.json <<'EOF'
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ],
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  }
}
EOF`,
  )
  .runCmd(
    `bun -e "const fs=require('fs');const f='tsconfig.app.json';const j=JSON.parse(fs.readFileSync(f,'utf8'));j.compilerOptions=j.compilerOptions||{};j.compilerOptions.baseUrl='.';j.compilerOptions.paths={'@/*':['./src/*']};fs.writeFileSync(f,JSON.stringify(j,null,2))"`,
  )

  // 6) The Hono API. Bun serves the default export (fetch + port) natively.
  .runCmd(
    `mkdir -p server && cat > server/index.ts <<'EOF'
import { Hono } from 'hono'

const app = new Hono()

// Health check.
app.get('/api/health', (c) => c.json({ ok: true }))

// GET with a route param + a query string.
//   /api/hello/ada?loud=true  ->  { message: "HELLO, ADA" }
app.get('/api/hello/:name', (c) => {
  const name = c.req.param('name')
  const loud = c.req.query('loud') === 'true'
  const message = \`Hello, \${name}\`
  return c.json({ message: loud ? message.toUpperCase() : message })
})

// POST with a JSON body. Read it with \`await c.req.json()\`. Return 201 by
// passing the status as the second arg to c.json().
app.post('/api/echo', async (c) => {
  const body = await c.req.json<{ text?: string }>()
  if (!body.text) return c.json({ error: 'text is required' }, 400)
  return c.json({ youSent: body.text, at: new Date().toISOString() }, 201)
})

// Add real routes here. When this grows, lift the whole \`server/\`
// directory out into its own deployment without touching the frontend.

export default { port: 3000, fetch: app.fetch }
EOF`,
  )

  // 7) shadcn
  .runCmd("bunx --bun shadcn@latest init -y -d")
  .runCmd(
    "bunx --bun shadcn@latest add -y " +
      "button input label textarea card badge separator skeleton " +
      "select checkbox switch radio-group slider " +
      "dialog alert-dialog sheet popover tooltip dropdown-menu alert sonner " +
      "tabs accordion avatar scroll-area table",
  )

  // 7a) Overwrite the shadcn-generated theme with a dark, Spotify-inspired
  //     palette.
  .runCmd(
    `cat > src/index.css <<'EOF'
@import "tailwindcss";
@import "tw-animate-css";

@custom-variant dark (&:is(.dark *));

/* :root is the LIGHT theme (active when the .dark class is absent). The app
   ships dark by default via <html class="dark"> below; this block exists so a
   theme switcher / light-mode request works by simply toggling that class. */
:root {
  --radius: 0.625rem;

  --background: #ffffff;
  --foreground: #121212;
  --card: #ffffff;
  --card-foreground: #121212;
  --popover: #ffffff;
  --popover-foreground: #121212;
  --primary: #1db954;
  --primary-foreground: #000000;
  --secondary: #f5f5f5;
  --secondary-foreground: #121212;
  --muted: #f0f0f0;
  --muted-foreground: #6a6a6a;
  --accent: #1ed760;
  --accent-foreground: #000000;
  --destructive: #e22134;
  --border: #e5e5e5;
  --input: #d4d4d4;
  --ring: #1db954;

  --chart-1: #1db954;
  --chart-2: #1ed760;
  --chart-3: #1aa34a;
  --chart-4: #169c46;
  --chart-5: #14833b;

  --sidebar: #f5f5f5;
  --sidebar-foreground: #121212;
  --sidebar-primary: #1db954;
  --sidebar-primary-foreground: #000000;
  --sidebar-accent: #ebebeb;
  --sidebar-accent-foreground: #121212;
  --sidebar-border: #e5e5e5;
  --sidebar-ring: #1db954;
}

/* .dark is the DEFAULT Spotify dark theme (html.dark is set in index.html). */
.dark {
  --background: #121212;
  --foreground: #ffffff;
  --card: #181818;
  --card-foreground: #ffffff;
  --popover: #282828;
  --popover-foreground: #ffffff;
  --primary: #1db954;
  --primary-foreground: #000000;
  --secondary: #282828;
  --secondary-foreground: #ffffff;
  --muted: #282828;
  --muted-foreground: #b3b3b3;
  --accent: #1ed760;
  --accent-foreground: #000000;
  --destructive: #e22134;
  --border: #282828;
  --input: #404040;
  --ring: #1db954;

  --chart-1: #1db954;
  --chart-2: #1ed760;
  --chart-3: #1aa34a;
  --chart-4: #169c46;
  --chart-5: #14833b;

  --sidebar: #000000;
  --sidebar-foreground: #b3b3b3;
  --sidebar-primary: #1db954;
  --sidebar-primary-foreground: #000000;
  --sidebar-accent: #282828;
  --sidebar-accent-foreground: #ffffff;
  --sidebar-border: #282828;
  --sidebar-ring: #1db954;
}

@theme inline {
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);

  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
  }
}
EOF`,
  )

  // 7b) Form deps only
  .runCmd(
    "bun add react-hook-form@^7 @radix-ui/react-slot@^1 zod@^3 @hookform/resolvers@^3",
  )

  // 7c) Routing + data layer. These are near-universal in agent-generated apps
  //     and all lightweight, so we bake AND wire them (a router/provider that
  //     isn't mounted is just boilerplate the agent has to write every time):
  .runCmd(
    "bun add react-router-dom@^7 @tanstack/react-query@^5 date-fns@^4 zustand@^5",
  )
  // Wire the providers into main.tsx so the agent inherits a working router +
  // query client instead of re-deriving the boilerplate on every build.
  .runCmd(
    `cat > src/main.tsx <<'EOF'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import './index.css'
import App from './App.tsx'

const queryClient = new QueryClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* QueryClientProvider: data-fetching cache for the whole tree */}
    <QueryClientProvider client={queryClient}>
      {/* TooltipProvider: lets any <Tooltip> work without re-wrapping */}
      <TooltipProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
        {/* Toaster (sonner): mounted once so toast() works app-wide */}
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
)
EOF`,
  )
  // App.tsx becomes a minimal route table the agent extends with <Route>s.
  .runCmd(
    `cat > src/App.tsx <<'EOF'
import { Routes, Route } from 'react-router-dom'

function Home() {
  return (
    <div className="flex min-h-svh items-center justify-center">
      <h1 className="text-2xl font-bold">App ready</h1>
    </div>
  )
}

function NotFound() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-2">
      <h1 className="text-3xl font-bold">404</h1>
      <p className="text-muted-foreground">This page could not be found.</p>
    </div>
  )
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      {/* Catch-all — keep this last so real routes match first. */}
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}

export default App
EOF`,
  )

  // 7d) Seed .tau/CONTEXT.md — the per-app memory the agent (tau) carries across
  //     turns. Two parts, separated by a hard marker:
  //       - everything ABOVE the marker is the static template manifest. The
  //         MASTER_PROMPT should tell tau to treat it as read-only; it stops the
  //         agent from re-installing deps it already has or hallucinating imports.
  //       - everything BELOW is the dynamic app state tau rewrites after changes.
  .runCmd(
    `mkdir -p .tau && cat > .tau/CONTEXT.md <<'EOF'
# tau — app context

<!-- ===================================================================== -->
<!-- STATIC — template manifest. Do NOT edit. Facts about the base image.  -->
<!-- ===================================================================== -->

## Stack
- Runtime: Bun 1.3
- Frontend: Vite + React + TypeScript + Tailwind v4 + shadcn/ui
- API: Hono on Bun (\`server/index.ts\`, port 3000)
- Dev preview: Vite on port 5173

## Conventions
- Import alias: \`@/*\` -> \`./src/*\`
- API calls: hit \`/api/*\` — Vite proxies them to Hono on :3000
- Routing is mounted in \`src/main.tsx\` (BrowserRouter); add pages as \`<Route>\`s in \`src/App.tsx\`
- React Query client is provided in \`src/main.tsx\` — use \`useQuery\`/\`useMutation\` directly
- Toasts: \`<Toaster />\` (sonner) is mounted in \`src/main.tsx\` — call \`toast()\` from \`sonner\` anywhere
- Tooltips: \`<TooltipProvider>\` wraps the app in \`src/main.tsx\` — use \`<Tooltip>\` without re-wrapping
- \`src/App.tsx\` has a catch-all \`*\` 404 route — keep it last when adding routes
- Theme: **Spotify-inspired**, **dark by default** (\`<html class="dark">\`). Both themes live in \`src/index.css\`: \`:root\` = light, \`.dark\` = dark (Spotify green \`#1DB954\` primary; dark surfaces step \`#121212\` -> \`#181818\` -> \`#282828\`, muted text \`#b3b3b3\`). Style with shadcn tokens (\`bg-background\`, \`text-foreground\`, \`bg-primary\`, \`bg-card\`, \`text-muted-foreground\`, \`border-border\`, …) — never hardcode hex colors. A **theme switcher just works** by toggling the \`dark\` class on \`<html>\` (persist the choice in \`localStorage\`); for light-only, default to no \`dark\` class. Edit the palettes in \`index.css\` rather than introducing parallel color systems.
- Secrets go in \`.env\` (gitignored); never commit them

## Hono API cheat-sheet (server/index.ts)
Add routes to the existing \`app\`; do NOT create a second Hono instance or call
\`app.listen\` (Bun serves the \`export default { port, fetch: app.fetch }\`).
- Route + handler: \`app.get('/api/things', (c) => c.json([...]))\`
- Route param: \`c.req.param('id')\`  ->  for \`/api/things/:id\`
- Query string: \`c.req.query('q')\`  (undefined if absent)
- JSON body (POST/PUT): \`const body = await c.req.json<{ x: string }>()\`
- Respond JSON with status: \`c.json({ error: '...' }, 400)\` (default 200)
- Text/redirect: \`c.text('ok')\`, \`c.redirect('/api/health')\`
- All \`/api/*\` paths are proxied from Vite (:5173) to Hono (:3000) — the frontend
  fetches relative URLs like \`fetch('/api/health')\`, never \`localhost:3000\`.
- See \`/api/hello/:name\` and \`POST /api/echo\` in server/index.ts for worked examples.

## Pre-installed dependencies (do not reinstall)
- Routing/data: react-router-dom, @tanstack/react-query, zustand, date-fns
- Forms: react-hook-form, zod, @hookform/resolvers
- UI primitives: class-variance-authority, clsx, tailwind-merge, lucide-react, tw-animate-css

## Pre-installed shadcn/ui components (do not re-add)
button input label textarea card badge separator skeleton
select checkbox switch radio-group slider
dialog alert-dialog sheet popover tooltip dropdown-menu alert sonner
tabs accordion avatar scroll-area table

## Adding more
- New shadcn component: \`bunx --bun shadcn@latest add <name> -y\`
- New dependency: \`bun add <pkg>\`
- Heavy/niche libs are intentionally NOT pre-installed (charts=recharts,
  carousel=embla, calendar=react-day-picker, drawer=vaul, command=cmdk,
  animation=framer-motion) — install them on demand if a task needs them.

## Implementation complexity — default to the simplest tier
Match effort to the request; the sandbox supporting a full DB + API is NOT a
reason to use one. Pick the LOWEST tier that fully satisfies the ask:
- **Tier 1 — React state (default):** \`useState\`/\`useReducer\`/Zustand for all UI
  state. Covers most requests (todo, counter, form, quiz, calculator, filter…).
- **Tier 2 — localStorage:** only when data must survive a refresh ("save between
  sessions", "remember my entries"). Use Zustand \`persist\` or a thin wrapper.
- **Tier 3 — Server API + DB (see below):** only for multi-user data, server-side
  logic, auth, or an explicitly requested API / "real" backend.
Pre-flight: before adding a route in \`server/index.ts\` or touching the DB, ask
"would React state (+ maybe localStorage) satisfy this?" — if yes, stay on Tier 1/2.

## Database (Tier 3 only — PGlite + Drizzle, add only when an app needs it)
No DB is baked in. When persistence is required, use this stack:
- \`bun add drizzle-orm @electric-sql/pglite drizzle-zod @hono/zod-validator\`
- PGlite = real Postgres in WASM, in-process, persists to a DIRECTORY at
  \`./data/pgdata\` (gitignore \`data/\`). Single-connection — fine because only the
  one Hono server talks to it. At deploy, swap the driver to Neon/Postgres
  (\`drizzle-orm/node-postgres\`); schema/queries stay (same pg dialect).
- Layout: \`server/db/schema.ts\` (pg-core tables), \`server/db/client.ts\`
  (PGlite + drizzle + idempotent \`initDb()\` run at server startup),
  \`server/db/validation.ts\` (zod via drizzle-zod). Routes use \`zValidator('json', schema)\`.
- Frontend talks to it through React Query hooks hitting \`/api/*\`.
- Worked end-to-end example: \`recipes/todo-pglite-drizzle.ts\` (copy its file
  contents). Do NOT use sqlite/bun:sqlite here — preview dialect must match the
  Postgres deploy target so there is no schema rewrite later.

## Drizzle cheat-sheet (pg-core)
- Define: \`export const todos = pgTable('todos', { id: serial('id').primaryKey(), title: text('title').notNull(), completed: boolean('completed').notNull().default(false) })\`
- Select: \`await db.select().from(todos).where(eq(todos.id, id))\`
- Insert (return row): \`const [row] = await db.insert(todos).values(data).returning()\`
- Update: \`await db.update(todos).set(data).where(eq(todos.id, id)).returning()\`
- Delete: \`await db.delete(todos).where(eq(todos.id, id)).returning()\`
- Import \`eq\`/\`and\`/\`desc\` from \`drizzle-orm\`. Validate request bodies with
  \`createInsertSchema(todos)\` (drizzle-zod) so the shape is defined once.

<!-- ===================================================================== -->
<!-- DYNAMIC — tau maintains everything below. Update after each change.    -->
<!-- ===================================================================== -->

## Current app
_Nothing built yet. Replace this section as the app takes shape:
what it does, key routes, key components/files, data model, and any
notable decisions._
EOF`,
  )

  // 8) Start the API in the background, Vite in the foreground. Ready when
  //    Vite's port is listening — more reliable than polling \`/\` for a 200.
  .setStartCmd(
    "bun --watch server/index.ts & bunx vite --host",
    waitForPort(5173),
  );
