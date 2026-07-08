/**
 * Shared build steps for the Vite + React + shadcn templates.
 *
 * The original `vite-react-hono.ts` template is intentionally left inline and
 * untouched; these helpers are composed by the newer template variants
 * (`vite-react.ts`, `vite-react-hono-db.ts`) so the three don't drift on the
 * parts they genuinely share (the Vite scaffold, Tailwind, shadcn, the theme,
 * and the router/query wiring).
 *
 * Each helper takes a `TemplateBuilder` and returns it after chaining its
 * `.runCmd(...)` steps, so a template file reads as a straight pipeline:
 *
 *   let t = Template().fromBunImage("1.3").setWorkdir(APP);
 *   t = scaffoldBase(t);
 *   t = writeViteConfig(t, { proxyApi: false });
 *   ...
 *   export const template = t.setStartCmd("bunx vite --host", waitForPort(5173));
 */
import type { TemplateBuilder } from "e2b";

export const APP = "/home/user/app";

/** shadcn components pre-added to every template. */
const SHADCN_COMPONENTS =
  "button input label textarea card badge separator skeleton " +
  "select checkbox switch radio-group slider " +
  "dialog alert-dialog sheet popover tooltip dropdown-menu alert sonner " +
  "tabs accordion avatar scroll-area table";

/**
 * 1) Scaffold Vite React-TS into the workdir, drop the demo assets, default the
 *    app to dark mode, git-init for snapshotting, and install the Tailwind v4 +
 *    shadcn runtime deps. This is identical across every template.
 */
export function scaffoldBase(t: TemplateBuilder): TemplateBuilder {
  return (
    t
      // Scaffold Vite React-TS directly into the workdir
      .runCmd("bun create vite@latest . --template react-ts")
      .runCmd("bun install")

      // Drop the scaffold's demo assets (public/vite.svg, src/assets/react.svg)
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
      // Default the app to dark mode (Spotify-style). The theme itself is
      // written into src/index.css by writeTheme() below.
      .runCmd(
        `sed -i 's/<html lang="en">/<html lang="en" class="dark">/' index.html`,
      )

      // git init so snapshots can use `git ls-files` (auto-respects .gitignore)
      // and you get history for free. The Vite scaffold already ignores
      // node_modules/dist; we make sure secrets are ignored too.
      .runCmd("git init -q")
      .runCmd("printf '\\n.env\\n.env.*\\n' >> .gitignore")

      // Tailwind v4 (Vite plugin) + shadcn runtime deps.
      .runCmd("bun add -d tailwindcss @tailwindcss/vite")
      .runCmd(
        "bun add class-variance-authority clsx tailwind-merge lucide-react tw-animate-css",
      )

      // Seed a minimal Tailwind entry stylesheet (writeTheme overwrites it later).
      .runCmd(
        `cat > src/index.css <<'EOF'
@import "tailwindcss";
@import "tw-animate-css";
EOF`,
      )
  );
}

/**
 * Wire vite.config.ts. `proxyApi` forwards `/api/*` to the Hono server on :3000
 * — enable it only for templates that actually ship a server.
 */
export function writeViteConfig(
  t: TemplateBuilder,
  { proxyApi }: { proxyApi: boolean },
): TemplateBuilder {
  const proxyLine = proxyApi
    ? `\n    proxy: { '/api': 'http://localhost:3000' }, // forward API calls to Hono`
    : "";
  return t.runCmd(
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
    allowedHosts: ['.e2b.app'],${proxyLine}
  },
})
EOF`,
  );
}

/** Wire the `@/*` path alias into both tsconfig files shadcn reads. */
export function writeTsconfig(t: TemplateBuilder): TemplateBuilder {
  return t
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
    );
}

/** Run `shadcn init` and add the standard component set. */
export function shadcnInit(t: TemplateBuilder): TemplateBuilder {
  return t
    .runCmd("bunx --bun shadcn@latest init -y -d")
    .runCmd(`bunx --bun shadcn@latest add -y ${SHADCN_COMPONENTS}`);
}

/** Overwrite src/index.css with the dark, Spotify-inspired theme. */
export function writeTheme(t: TemplateBuilder): TemplateBuilder {
  return t.runCmd(
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
  );
}

/**
 * Install the form + routing + data deps and wire the router / query client /
 * tooltip / toaster providers into main.tsx, plus a minimal route table in
 * App.tsx. Identical across templates.
 */
export function writeAppShell(t: TemplateBuilder): TemplateBuilder {
  return (
    t
      // Form deps
      .runCmd(
        "bun add react-hook-form@^7 @radix-ui/react-slot@^1 zod@^3 @hookform/resolvers@^3",
      )
      // Routing + data layer. Near-universal in agent-generated apps and all
      // lightweight, so we bake AND wire them.
      .runCmd(
        "bun add react-router-dom@^7 @tanstack/react-query@^5 date-fns@^4 zustand@^5",
      )
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
  );
}

/**
 * Install Hono and seed a minimal `server/index.ts`. Bun serves the default
 * export natively — no adapter, no app.listen.
 */
export function writeHonoApi(t: TemplateBuilder): TemplateBuilder {
  return t.runCmd("bun add hono").runCmd(
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
  );
}

/**
 * Install the PGlite + Drizzle stack and scaffold a ready-to-use `server/db/`
 * (schema, client with an idempotent initDb, zod validation) wired into
 * `server/index.ts`. Only the DB-baked template calls this.
 */
export function writeDbStack(t: TemplateBuilder): TemplateBuilder {
  return (
    t
      .runCmd(
        "bun add drizzle-orm @electric-sql/pglite drizzle-zod @hono/zod-validator",
      )
      // Persist PGlite to a gitignored directory.
      .runCmd("printf '\\ndata/\\n' >> .gitignore")
      .runCmd(
        `mkdir -p server/db && cat > server/db/schema.ts <<'EOF'
import { pgTable, serial, text, boolean, timestamp } from 'drizzle-orm/pg-core'

// Example table. Replace / extend with the app's real schema, then reflect the
// change in initDb() (server/db/client.ts) so a fresh sandbox creates it.
export const items = pgTable('items', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  done: boolean('done').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})
EOF`,
      )
      .runCmd(
        `cat > server/db/client.ts <<'EOF'
import { mkdirSync } from 'fs'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import * as schema from './schema'

// PGlite = real Postgres in WASM, in-process, persisted to ./data/pgdata.
// Single connection is fine: only this one Hono server talks to it. At deploy,
// swap this driver for drizzle-orm/node-postgres (Neon/Postgres) — the schema
// and queries stay identical because the dialect is the same.
mkdirSync('./data', { recursive: true })
const client = new PGlite('./data/pgdata')

export const db = drizzle(client, { schema })

// Idempotent bootstrap run once at server startup. Keep this in sync with
// schema.ts (CREATE TABLE IF NOT EXISTS for every table you define).
let initialized = false
export async function initDb() {
  if (initialized) return
  await client.exec(\`
    CREATE TABLE IF NOT EXISTS items (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      done BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMP NOT NULL DEFAULT now()
    );
  \`)
  initialized = true
}
EOF`,
      )
      .runCmd(
        `cat > server/db/validation.ts <<'EOF'
import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import { items } from './schema'

// Single source of truth for request/response shapes. Use insertItemSchema with
// @hono/zod-validator's zValidator('json', insertItemSchema) on write routes.
export const insertItemSchema = createInsertSchema(items)
export const selectItemSchema = createSelectSchema(items)
EOF`,
      )
      // Rewrite server/index.ts to call initDb() at startup and show a worked
      // DB-backed route alongside the plain examples.
      .runCmd(
        `mkdir -p server && cat > server/index.ts <<'EOF'
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { eq } from 'drizzle-orm'
import { db, initDb } from './db/client'
import { items } from './db/schema'
import { insertItemSchema } from './db/validation'

// Create tables before the server handles a request.
await initDb()

const app = new Hono()

// Health check.
app.get('/api/health', (c) => c.json({ ok: true }))

// --- Worked DB-backed CRUD example over the \`items\` table --------------------
// The DB is already wired (server/db/*). Extend the schema + initDb() and add
// routes like these for the app's real data.

app.get('/api/items', async (c) => {
  const rows = await db.select().from(items)
  return c.json(rows)
})

app.post('/api/items', zValidator('json', insertItemSchema), async (c) => {
  const data = c.req.valid('json')
  const [row] = await db.insert(items).values(data).returning()
  return c.json(row, 201)
})

app.delete('/api/items/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const [row] = await db.delete(items).where(eq(items.id, id)).returning()
  if (!row) return c.json({ error: 'not found' }, 404)
  return c.json(row)
})

export default { port: 3000, fetch: app.fetch }
EOF`,
      )
  );
}

/**
 * Write `.tau/CONTEXT.md` — the per-app memory tau carries across turns. The
 * static manifest above the DYNAMIC marker is tailored to the template's actual
 * stack so the agent never hallucinates a backend/DB it doesn't have (or misses
 * one it does).
 */
export function writeContext(
  t: TemplateBuilder,
  { hasServer, hasDb }: { hasServer: boolean; hasDb: boolean },
): TemplateBuilder {
  return t.runCmd(
    `mkdir -p .tau && cat > .tau/CONTEXT.md <<'EOF'
${buildContextMd({ hasServer, hasDb })}
EOF`,
  );
}

export function buildContextMd({
  hasServer,
  hasDb,
}: {
  hasServer: boolean;
  hasDb: boolean;
}): string {
  const stackLines = [
    "- Runtime: Bun 1.3",
    "- Frontend: Vite + React + TypeScript + Tailwind v4 + shadcn/ui",
  ];
  if (hasServer) {
    stackLines.push("- API: Hono on Bun (`server/index.ts`, port 3000)");
  }
  if (hasDb) {
    stackLines.push(
      "- Database: PGlite (Postgres in WASM) + Drizzle — **pre-installed and wired** (`server/db/`)",
    );
  }
  stackLines.push("- Dev preview: Vite on port 5173");

  const conventions = [
    "- Import alias: `@/*` -> `./src/*`",
  ];
  if (hasServer) {
    conventions.push(
      "- API calls: hit `/api/*` — Vite proxies them to Hono on :3000",
    );
  }
  conventions.push(
    "- Routing is mounted in `src/main.tsx` (BrowserRouter); add pages as `<Route>`s in `src/App.tsx`",
    "- React Query client is provided in `src/main.tsx` — use `useQuery`/`useMutation` directly",
    "- Toasts: `<Toaster />` (sonner) is mounted in `src/main.tsx` — call `toast()` from `sonner` anywhere",
    "- Tooltips: `<TooltipProvider>` wraps the app in `src/main.tsx` — use `<Tooltip>` without re-wrapping",
    "- `src/App.tsx` has a catch-all `*` 404 route — keep it last when adding routes",
    "- Theme: **Spotify-inspired**, **dark by default** (`<html class=\"dark\">`). Both themes live in `src/index.css`: `:root` = light, `.dark` = dark (Spotify green `#1DB954` primary; dark surfaces step `#121212` -> `#181818` -> `#282828`, muted text `#b3b3b3`). Style with shadcn tokens (`bg-background`, `text-foreground`, `bg-primary`, `bg-card`, `text-muted-foreground`, `border-border`, …) — never hardcode hex colors. A **theme switcher just works** by toggling the `dark` class on `<html>` (persist the choice in `localStorage`); for light-only, default to no `dark` class. Edit the palettes in `index.css` rather than introducing parallel color systems.",
    "- Secrets go in `.env` (gitignored); never commit them",
  );

  const honoSection = hasServer
    ? `
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
`
    : "";

  const depsLines = [
    "- Routing/data: react-router-dom, @tanstack/react-query, zustand, date-fns",
    "- Forms: react-hook-form, zod, @hookform/resolvers",
    "- UI primitives: class-variance-authority, clsx, tailwind-merge, lucide-react, tw-animate-css",
  ];
  if (hasDb) {
    depsLines.push(
      "- Database: drizzle-orm, @electric-sql/pglite, drizzle-zod, @hono/zod-validator",
    );
  }

  // The complexity ladder — its top tier and the DB paragraph differ per template.
  const complexitySection = buildComplexitySection({ hasServer, hasDb });
  const dbSection = buildDbSection({ hasServer, hasDb });

  return `# tau — app context

<!-- ===================================================================== -->
<!-- STATIC — template manifest. Do NOT edit. Facts about the base image.  -->
<!-- ===================================================================== -->

## Stack
${stackLines.join("\n")}

## Conventions
${conventions.join("\n")}
${honoSection}
## Pre-installed dependencies (do not reinstall)
${depsLines.join("\n")}

## Pre-installed shadcn/ui components (do not re-add)
${SHADCN_COMPONENTS.replace(/ /g, " ")}

## Adding more
- New shadcn component: \`bunx --bun shadcn@latest add <name> -y\`
- New dependency: \`bun add <pkg>\`
- Heavy/niche libs are intentionally NOT pre-installed (charts=recharts,
  carousel=embla, calendar=react-day-picker, drawer=vaul, command=cmdk,
  animation=framer-motion) — install them on demand if a task needs them.
${complexitySection}${dbSection}
<!-- ===================================================================== -->
<!-- DYNAMIC — tau maintains everything below. Update after each change.    -->
<!-- ===================================================================== -->

## Current app
_Nothing built yet. Replace this section as the app takes shape:
what it does, key routes, key components/files, data model, and any
notable decisions._`;
}

function buildComplexitySection({
  hasServer,
  hasDb,
}: {
  hasServer: boolean;
  hasDb: boolean;
}): string {
  if (!hasServer) {
    // Frontend-only: there is no backend at all, so the ladder tops out at
    // client-side persistence.
    return `
## Implementation complexity — default to the simplest tier
This is a **frontend-only** app: there is no server and no database. Keep all
state and persistence in the browser. Pick the LOWEST tier that satisfies the ask:
- **Tier 1 — React state (default):** \`useState\`/\`useReducer\`/Zustand for all UI
  state. Covers most requests (todo, counter, form, quiz, calculator, filter…).
- **Tier 2 — localStorage:** only when data must survive a refresh ("save between
  sessions", "remember my entries"). Use Zustand \`persist\` or a thin wrapper.
There is no Tier 3 here. If a request genuinely needs a server or shared/multi-user
data, say so plainly — this template cannot provide it.
`;
  }

  const tier3 = hasDb
    ? `- **Tier 3 — Server API + DB:** for multi-user data, server-side logic, auth, or
  an explicitly requested API / "real" backend. The Hono API **and a PGlite +
  Drizzle database are already wired** (see below) — just add routes and tables.`
    : `- **Tier 3 — Server API + DB (see below):** only for multi-user data, server-side
  logic, auth, or an explicitly requested API / "real" backend.`;

  return `
## Implementation complexity — default to the simplest tier
Match effort to the request; the sandbox supporting a full DB + API is NOT a
reason to use one. Pick the LOWEST tier that fully satisfies the ask:
- **Tier 1 — React state (default):** \`useState\`/\`useReducer\`/Zustand for all UI
  state. Covers most requests (todo, counter, form, quiz, calculator, filter…).
- **Tier 2 — localStorage:** only when data must survive a refresh ("save between
  sessions", "remember my entries"). Use Zustand \`persist\` or a thin wrapper.
${tier3}
Pre-flight: before adding a route in \`server/index.ts\` or touching the DB, ask
"would React state (+ maybe localStorage) satisfy this?" — if yes, stay on Tier 1/2.
`;
}

function buildDbSection({
  hasServer,
  hasDb,
}: {
  hasServer: boolean;
  hasDb: boolean;
}): string {
  if (!hasServer) return "";

  if (hasDb) {
    return `
## Database (PGlite + Drizzle — already wired, just use it)
The DB is **pre-installed and bootstrapped**. Do NOT reinstall or re-scaffold it.
- Layout: \`server/db/schema.ts\` (pg-core tables), \`server/db/client.ts\`
  (PGlite + drizzle + idempotent \`initDb()\`, already called at server startup),
  \`server/db/validation.ts\` (zod via drizzle-zod).
- \`server/index.ts\` already imports the db, calls \`initDb()\`, and ships a worked
  CRUD example over the \`items\` table. Add real tables to \`schema.ts\`, mirror them
  in \`initDb()\`'s \`CREATE TABLE IF NOT EXISTS\`, then add routes.
- PGlite persists to \`./data/pgdata\` (gitignored). Single-connection — fine, only
  the one Hono server talks to it. At deploy, swap the driver to Neon/Postgres
  (\`drizzle-orm/node-postgres\`); schema/queries stay (same pg dialect).
- Frontend talks to it through React Query hooks hitting \`/api/*\`.
- Validate request bodies with \`zValidator('json', insertItemSchema)\` (already
  imported in the example). Do NOT use sqlite/bun:sqlite — the dialect must match
  the Postgres deploy target.

## Drizzle cheat-sheet (pg-core)
- Define: \`export const todos = pgTable('todos', { id: serial('id').primaryKey(), title: text('title').notNull(), completed: boolean('completed').notNull().default(false) })\`
- Select: \`await db.select().from(todos).where(eq(todos.id, id))\`
- Insert (return row): \`const [row] = await db.insert(todos).values(data).returning()\`
- Update: \`await db.update(todos).set(data).where(eq(todos.id, id)).returning()\`
- Delete: \`await db.delete(todos).where(eq(todos.id, id)).returning()\`
- Import \`eq\`/\`and\`/\`desc\` from \`drizzle-orm\`. Validate request bodies with
  \`createInsertSchema(todos)\` (drizzle-zod) so the shape is defined once.
`;
  }

  // Server present but no DB baked — the add-on recipe (matches the original).
  return `
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
- Do NOT use sqlite/bun:sqlite here — preview dialect must match the
  Postgres deploy target so there is no schema rewrite later.

## Drizzle cheat-sheet (pg-core)
- Define: \`export const todos = pgTable('todos', { id: serial('id').primaryKey(), title: text('title').notNull(), completed: boolean('completed').notNull().default(false) })\`
- Select: \`await db.select().from(todos).where(eq(todos.id, id))\`
- Insert (return row): \`const [row] = await db.insert(todos).values(data).returning()\`
- Update: \`await db.update(todos).set(data).where(eq(todos.id, id)).returning()\`
- Delete: \`await db.delete(todos).where(eq(todos.id, id)).returning()\`
- Import \`eq\`/\`and\`/\`desc\` from \`drizzle-orm\`. Validate request bodies with
  \`createInsertSchema(todos)\` (drizzle-zod) so the shape is defined once.
`;
}
