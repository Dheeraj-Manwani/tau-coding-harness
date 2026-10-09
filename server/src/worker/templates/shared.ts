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
import { readFileSync } from "node:fs";
import type { TemplateBuilder } from "e2b";
import { buildThemeCss, NEUTRAL_THEME } from "./theme";

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
  opts: { proxyApi: boolean },
): TemplateBuilder {
  return t.runCmd(
    `cat > vite.config.ts <<'EOF'\n${writeViteConfigContent(opts)}EOF`,
  );
}

/**
 * The same file as a value.
 *
 * `migrateTemplate` needs these bytes when a project's `vite.config.ts` has
 * been rewritten badly enough that the proxy line can't be inserted into it
 * (doc/AI_FOR_GENERATED_APPS.md §7.3 step 2). One definition, two consumers.
 */
export function writeViteConfigContent({
  proxyApi,
}: {
  proxyApi: boolean;
}): string {
  const proxyLine = proxyApi ? `\n${VITE_API_PROXY_LINE}` : "";
  // tauTagger is listed last deliberately: it declares `enforce: 'pre'`, so
  // Vite orders it ahead of the React plugin regardless of array position.
  // Relying on `enforce` rather than position means an agent that reorders this
  // array (or inserts a plugin in front) can't silently break visual edit.
  return `import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
${VITE_TAILWIND_IMPORT_LINE}
${VISUAL_EDIT_IMPORT_LINE}

export default defineConfig({
${VITE_PLUGINS_PREFIX}, ${VISUAL_EDIT_PLUGIN_ENTRY}],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: {
    host: true,            // bind 0.0.0.0 so E2B can forward the preview port
    port: 5173,
    // Vite blocks requests whose Host header isn't whitelisted. The E2B preview
    // domain is dynamic (5173-<sandboxId>.e2b.app), so allow the whole suffix —
    // without this you get a 403 'host not allowed' page even though Vite is up.
${VITE_ALLOWED_HOSTS_LINE}${proxyLine}
  },
})
`;
}

/**
 * Wire the `@/*` path alias so it resolves everywhere: shadcn/editors (root
 * `tsconfig.json`) AND `tsc -b` (the app project, which is what the `build`
 * script actually compiles). References do NOT inherit compilerOptions, so the
 * alias must live in `tsconfig.app.json` too — the previous version only patched
 * the root config, so `bun run build` failed with TS2307 on every `@/…` import.
 *
 * Two gotchas handled here:
 *   - `tsconfig.app.json` ships `// /* … *\/` comments, so `JSON.parse` throws —
 *     we inject with `sed` (comment-safe text insertion) instead.
 *   - `baseUrl` is deprecated in TS 6+ (errors with TS5101); modern `paths`
 *     resolves relative to the tsconfig without it, so we omit `baseUrl`.
 * We also relax `noUnusedLocals`/`noUnusedParameters`, which otherwise fail the
 * build on shadcn boilerplate (e.g. an unused `React` import) and on the WIP,
 * half-wired code the agent naturally produces mid-task.
 */
export function writeTsconfig(t: TemplateBuilder): TemplateBuilder {
  return (
    t
      .runCmd(
        `cat > tsconfig.json <<'EOF'
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ],
  "compilerOptions": {
    "paths": { "@/*": ["./src/*"] }
  }
}
EOF`,
      )
      // Inject the alias as the first key inside compilerOptions.
      .runCmd(
        `sed -i 's#"compilerOptions": {#"compilerOptions": {\\n    "paths": { "@/*": ["./src/*"] },#' tsconfig.app.json`,
      )
      // Don't fail the build on unused symbols (shadcn boilerplate + agent WIP).
      .runCmd(
        `sed -i 's#"noUnusedLocals": true#"noUnusedLocals": false#' tsconfig.app.json`,
      )
      .runCmd(
        `sed -i 's#"noUnusedParameters": true#"noUnusedParameters": false#' tsconfig.app.json`,
      )
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
        {/* Toaster (sonner): mounted once so toast() works app-wide.
            bottom-center keeps the bottom-right corner clear for tau's badge. */}
        <Toaster position="bottom-center" />
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
 * The scaffolded `server/index.ts`, as a value.
 *
 * Exported because two things need these exact bytes and they must not drift:
 * the template build below bakes it into the E2B image, and `migrateTemplate`
 * writes it into the manifest when a `frontend` project grows a backend
 * (doc/AI_FOR_GENERATED_APPS.md §7.3 step 4). A second copy in the migration
 * would be a copy that silently ages.
 */
export const HONO_SERVER_INDEX = `import { Hono } from 'hono'

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
`;

/** The Vite dev-server proxy line that makes \`/api/*\` reach Hono on :3000. */
export const VITE_API_PROXY_LINE =
  `    proxy: { '/api': 'http://localhost:3000' }, // forward API calls to Hono`;

/** The anchor the proxy line is inserted after when migrating an existing app. */
export const VITE_ALLOWED_HOSTS_LINE = `    allowedHosts: ['.e2b.app'],`;

/**
 * The two anchors the Phase 5 visual-edit retrofit patches against
 * (`lib/retrofitVisualEdit.ts`). They are interpolated into the config above
 * rather than written inline so a retrofitted project's `vite.config.ts` comes
 * out byte-identical to a freshly provisioned one — a test asserts exactly that,
 * and it can only hold while there is one definition of each string.
 */
export const VITE_TAILWIND_IMPORT_LINE = `import tailwindcss from '@tailwindcss/vite'`;
export const VITE_PLUGINS_PREFIX = `  plugins: [react(), tailwindcss()`;

// ── Visual edit (doc/archive/VISUAL_EDIT_PLAN.md) ────────────────────────────────────

/**
 * Import + plugin entries that switch visual edit on in `vite.config.ts`.
 *
 * The `.js` extension is load-bearing and is NOT a typo. The Vite react-ts
 * scaffold's `tsconfig.node.json` sets `"module": "nodenext"`, which rejects
 * extensionless relative ESM imports (TS2835) — so a bare `'./.tau/tagger'`
 * fails `tsc -b`, and therefore fails `bun run build`, for every app tau
 * generates. `.js` is TypeScript's ESM convention for "the emitted name of
 * `tagger.ts`", and Vite's esbuild config loader resolves it to the source too.
 * Verified end to end by scripts/spike-visual-edit.ts.
 */
export const VISUAL_EDIT_IMPORT_LINE = `import { tauTagger } from './.tau/tagger.js'`;
export const VISUAL_EDIT_PLUGIN_ENTRY = `tauTagger()`;

/**
 * devDependencies the tagger needs. Both are dev-only and tiny; neither reaches
 * the production bundle (`apply: 'serve'`).
 *
 * Ranges are explicit rather than left to `bun add`'s "whatever is latest
 * today", because the Phase 5 retrofit has to write these same entries straight
 * into an existing `package.json` where there is no registry lookup to defer to.
 * One definition, two consumers — a retrofitted project must end up with the
 * package.json a freshly provisioned one has.
 */
export const VISUAL_EDIT_DEPS: Readonly<Record<string, string>> = {
  "@babel/parser": "^7",
  "magic-string": "^0.30",
};

/** The same set as a `bun add -d` argument list. */
export const VISUAL_EDIT_DEPS_ARGS = Object.entries(VISUAL_EDIT_DEPS)
  .map(([name, range]) => `${name}@${range}`)
  .join(" ");

/**
 * Read one of the visual-edit assets off disk.
 *
 * Kept as real `.ts`/`.js` files under `templates/visual-edit/` rather than
 * string constants so they stay lintable, syntax-checkable and diffable — they
 * are ~400 lines of real code, not a snippet. Read lazily: this runs at
 * template-build time (and, later, at migration time), never on the hot path.
 *
 * `templates/visual-edit/` is excluded from the worker's tsconfig — the tagger
 * imports `@babel/parser`/`magic-string`, which are dependencies of the
 * *generated app*, not of this service.
 */
export function readVisualEditAsset(name: "tagger.ts" | "runtime.js"): string {
  const path = new URL(`./visual-edit/${name}`, import.meta.url);
  return readFileSync(path, "utf8");
}

/**
 * Install the visual-edit tagger into the app.
 *
 * Ships two files under `.tau/` (the established convention for tau-owned
 * files, alongside `CONTEXT.md`, `logs/` and `deploy.json`) plus two dev
 * dependencies. The Vite plugin is registered by `writeViteConfigContent`.
 *
 * The runtime is *not* written into the project as a script the app imports —
 * the plugin injects it via `transformIndexHtml`, dev-server only. So it never
 * enters the file manifest, never reaches the user's GitHub push, and never
 * appears in the production build.
 */
export function writeVisualEdit(t: TemplateBuilder): TemplateBuilder {
  // `<<'EOF'` (quoted delimiter) means the shell expands nothing, so the
  // backticks and `${}` inside the tagger land verbatim.
  return t
    .runCmd(`bun add -d ${VISUAL_EDIT_DEPS_ARGS}`)
    .runCmd("mkdir -p .tau")
    .runCmd(
      `cat > .tau/tagger.ts <<'EOF'\n${readVisualEditAsset("tagger.ts")}EOF`,
    )
    .runCmd(
      `cat > .tau/runtime.js <<'EOF'\n${readVisualEditAsset("runtime.js")}EOF`,
    );
}

/**
 * Install Hono and seed a minimal `server/index.ts`. Bun serves the default
 * export natively — no adapter, no app.listen. The same default export is what
 * a published app hands to its Node entry (`lambdaEntry` in
 * `worker/lib/deployTransforms.ts`), which is why the contract is only
 * `{ port, fetch }` and why preflight refuses `Bun.*` under `server/`.
 */
export function writeHonoApi(t: TemplateBuilder): TemplateBuilder {
  // `<<'EOF'` (quoted delimiter) means the shell expands nothing, so the
  // backticks and `${}` inside the constant land verbatim.
  return t
    .runCmd("bun add hono")
    .runCmd(
      `mkdir -p server && cat > server/index.ts <<'EOF'\n${HONO_SERVER_INDEX}EOF`,
    );
}

// The four files the database setup writes, as values.
//
// Two consumers need these exact bytes and they must not drift: `writeDbStack`
// bakes them into the generation-1 `vite-hono-db-app` image, and the in-place
// database setup for generation-2 apps (`lib/appStack.ts`) writes them into a
// running sandbox. Same reasoning as `HONO_SERVER_INDEX` above.

/** `server/db/schema.ts` as scaffolded: one example table. */
export const DB_SCHEMA_TS = `import { pgTable, serial, text, boolean, timestamp } from 'drizzle-orm/pg-core'

// Example table. Replace / extend with the app's real schema, then reflect the
// change in initDb() (server/db/client.ts) so a fresh sandbox creates it.
export const items = pgTable('items', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  done: boolean('done').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})
`;

/** `server/db/client.ts` as scaffolded: PGlite + Drizzle and an idempotent `initDb()`. */
export const DB_CLIENT_TS = `import { mkdirSync } from 'fs'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import * as schema from './schema'

// PGlite = real Postgres in WASM, in-process, persisted to ./data/pgdata.
// Single connection is fine: only this one Hono server talks to it. At publish,
// tau replaces this whole file with one on drizzle-orm/node-postgres
// (productionDbClient in worker/lib/deployTransforms.ts), built from the SQL
// in initDb() below and keeping these same two exports. So keep that SQL as
// plain text in one client.exec() call with no interpolation inside it, and
// export nothing else that other code uses.
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
`;

/** `server/db/validation.ts` as scaffolded: zod schemas derived from the table. */
export const DB_VALIDATION_TS = `import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import { items } from './schema'

// Single source of truth for request/response shapes. Use insertItemSchema with
// @hono/zod-validator's zValidator('json', insertItemSchema) on write routes.
export const insertItemSchema = createInsertSchema(items)
export const selectItemSchema = createSelectSchema(items)
`;

/** `server/index.ts` with the database wired in: `initDb()` at startup and a worked CRUD example. */
export const HONO_DB_SERVER_INDEX = `import { Hono } from 'hono'
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
`;

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
        `mkdir -p server/db && cat > server/db/schema.ts <<'EOF'\n${DB_SCHEMA_TS}EOF`,
      )
      .runCmd(
        `cat > server/db/client.ts <<'EOF'\n${DB_CLIENT_TS}EOF`,
      )
      .runCmd(
        `cat > server/db/validation.ts <<'EOF'\n${DB_VALIDATION_TS}EOF`,
      )
      // Rewrite server/index.ts to call initDb() at startup and show a worked
      // DB-backed route alongside the plain examples.
      .runCmd(
        `mkdir -p server && cat > server/index.ts <<'EOF'\n${HONO_DB_SERVER_INDEX}EOF`,
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

  const conventions = ["- Import alias: `@/*` -> `./src/*`"];
  if (hasServer) {
    conventions.push(
      "- API calls: hit `/api/*` — Vite proxies them to Hono on :3000",
    );
  }
  conventions.push(
    "- Routing is mounted in `src/main.tsx` (BrowserRouter); add pages as `<Route>`s in `src/App.tsx`",
    "- React Query client is provided in `src/main.tsx` — use `useQuery`/`useMutation` directly",
    "- Toasts: `<Toaster position=\"bottom-center\" />` (sonner) is mounted in `src/main.tsx` — call `toast()` from `sonner` anywhere. Keep toasts bottom-center: the bottom-right corner is reserved for tau's badge",
    "- Tooltips: `<TooltipProvider>` wraps the app in `src/main.tsx` — use `<Tooltip>` without re-wrapping",
    "- `src/App.tsx` has a catch-all `*` 404 route — keep it last when adding routes",
    '- Theme: **Spotify-inspired**, **dark by default** (`<html class="dark">`). Both themes live in `src/index.css`: `:root` = light, `.dark` = dark (Spotify green `#1DB954` primary; dark surfaces step `#121212` -> `#181818` -> `#282828`, muted text `#b3b3b3`). Style with shadcn tokens (`bg-background`, `text-foreground`, `bg-primary`, `bg-card`, `text-muted-foreground`, `border-border`, …) — never hardcode hex colors. A **theme switcher just works** by toggling the `dark` class on `<html>` (persist the choice in `localStorage`); for light-only, default to no `dark` class. Edit the palettes in `index.css` rather than introducing parallel color systems.',
    "- Secrets go in `.env` (gitignored); never commit them. `.env` is NOT saved with the project — tau rewrites it each run",
    "- `.tau/` is tau's own directory. The only thing you may edit in it is the `## Current app` section of `CONTEXT.md`. Leave `tagger.ts` and `runtime.js` alone, and leave the `tauTagger()` plugin in `vite.config.ts` alone — they power click-to-edit in the preview and are dev-only (`apply: 'serve'`), so they never reach a production build",
  );
  if (hasServer) {
    // Deliberately one line. The full recipe is the `enable_ai` tool's return
    // value, because that ships with a normal deploy — changing this file means
    // rebuilding and republishing the E2B image.
    conventions.push(
      "- AI features: call the `enable_ai` tool first, then `fetch` `${process.env.TAU_AI_URL}/chat` from `server/index.ts` with `Authorization: Bearer ${process.env.TAU_API_KEY}` and `X-Tau-Project: ${process.env.TAU_PROJECT_ID}` headers. Nothing to install. Never put the key in frontend code",
    );
  }

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

// ── Generation 2 (`tau-app-v2`) ──────────────────────────────────────────────
//
// One base image instead of three (doc/CONTEXT_AND_MEMORY_PLAN.md §6). These
// are new helpers rather than edits to the ones above, on purpose: the
// generation-1 templates still compose `writeTheme`, `writeContext` and
// friends, production still boots from the images they build, and those images
// have to stay rebuildable exactly as they are.

/** Overwrite src/index.css with the neutral starting palette (see theme.ts). */
export function writeNeutralTheme(t: TemplateBuilder): TemplateBuilder {
  return t.runCmd(
    `cat > src/index.css <<'EOF'\n${buildThemeCss(NEUTRAL_THEME)}EOF`,
  );
}

/** Where the app's icon lives, relative to the app. Vite serves it at `/favicon.svg`. */
export const APP_ICON_PATH = "public/favicon.svg";

/** The `<link>` in `index.html` that points at it. */
export const APP_ICON_LINK_TAG = `<link rel="icon" type="image/svg+xml" href="/favicon.svg" />`;

/**
 * The icon every app starts with: the white tau mark on a black disc, the same
 * picture `web/` and `landing/` use as their favicon.
 *
 * Drawn as a vector rather than copied from their PNGs, for two reasons. The
 * template seed reads every file in the image as text (`seedTemplateFiles`),
 * which would corrupt a binary icon on its way into the manifest. And an SVG
 * needs no set of sizes. The mark is the path the badge uses
 * (`lib/badge/badge.js`), scaled to sit in the disc as it does in the PNG.
 *
 * Unlike the badge this is part of the app's source: it is the default, the
 * owner replaces it when they publish (doc/PUBLISHING.md D7), and until then it
 * is what a browser tab and a shared link show.
 */
export const APP_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" aria-label="tau">
  <circle cx="16" cy="16" r="16" fill="#000"/>
  <path fill="#fff" transform="translate(4.7 3.6) scale(0.98)" d="M7.5 1.8H21.4C21.9 1.8 22.1 2.2 22 2.7C21.4 4.8 20.1 5.9 18 5.9H12.8L10.9 14.4C10.5 16.5 11 19.2 12.9 19.2C14.4 19.2 15.8 18.2 17.1 16.7C17.5 16.3 18.1 16.6 17.9 17.2C16.9 20.3 14.6 22.6 11.6 22.6C7.9 22.6 5.4 20 6.3 15.7L8.2 5.9C5.4 5.9 3.3 6.4 1.9 8C1.5 8.4 0.9 8.1 1.1 7.6C2.4 4.2 4.7 1.8 7.5 1.8Z"/>
</svg>
`;

/**
 * Give the app its icon: write the file and link it from `index.html`.
 *
 * `scaffoldBase` deletes the Vite scaffold's own icon and empties `public/`,
 * which leaves an app with no icon at all. Any icon link the scaffold still
 * carries is dropped first, whatever file it names, so there is exactly one.
 */
export function writeAppIcon(t: TemplateBuilder): TemplateBuilder {
  return t
    .runCmd(
      `mkdir -p public && cat > ${APP_ICON_PATH} <<'EOF'\n${APP_ICON_SVG}EOF`,
    )
    .runCmd(`sed -i '/rel="icon"/d' index.html`)
    .runCmd(
      `sed -i 's#</head>#  ${APP_ICON_LINK_TAG}\\n  </head>#' index.html`,
    );
}

/**
 * Where the dev server's own output is kept: beside the app, not in it, with
 * tau's other files for a preview (`PREVIEW_BADGE_SANDBOX_PATH`). Outside the
 * app it is not something Vite watches, and can never be seeded into a project.
 */
export const DEV_SERVER_LOG_PATH = "/home/user/.tau-vite.log";

/** The program that writes it, baked into the image. */
export const DEV_SERVER_LOG_CAP_PATH = "/home/user/.tau-logcap.awk";

/**
 * The most the log is let grow to before it is started again. The newest part
 * is what anyone reads, and it is read whole on the way to a prompt.
 */
export const DEV_SERVER_LOG_MAX_BYTES = 256 * 1024;

/**
 * Writes what it is given to the file `f`, and starts the file again whenever
 * it has grown past `max` bytes.
 *
 * The cap is not a nicety. While a browser has a broken app open, the dev
 * server (Vite 8.3) tries the failing file again without pause and prints the
 * same error each time: measured on a real sandbox, about 270 KB a second, for
 * as long as the app stays broken. Kept whole, that is a gigabyte an hour on a
 * small disk. This was always happening; until the output was kept, it went
 * nowhere and nobody saw it.
 *
 * awk because it is in the image already, flushes line by line, and is one
 * process with nothing to install. A line is never cut in two.
 */
export const DEV_SERVER_LOG_CAP_AWK = `BEGIN { printf "" > f; close(f); n = 0 }
{
  if (n > max) { close(f); printf "" > f; close(f); n = 0 }
  print >> f
  fflush(f)
  n += length($0) + 1
}
`;

/**
 * What the image runs when a sandbox boots: Vite, with everything it prints
 * kept in a file of bounded size.
 *
 * The older images start Vite with its output going nowhere, so when the dev
 * server could not compile a file, prepare a dependency or reach the API it
 * proxies to, nothing tau or its agent could read said why
 * (doc/AGENT_TOOLING_FEEDBACK.md, phase 7).
 *
 * `-W interactive` is load-bearing. The image's awk is mawk, which reads a
 * pipe a block at a time: without the flag a line Vite printed sits unread
 * until four kilobytes have followed it, and the log of a server that printed
 * one error and stopped is empty. (Found by the template check: the file was
 * there and had nothing in it.)
 */
export const DEV_SERVER_START_CMD = `bunx vite --host 2>&1 | awk -W interactive -v f=${DEV_SERVER_LOG_PATH} -v max=${DEV_SERVER_LOG_MAX_BYTES} -f ${DEV_SERVER_LOG_CAP_PATH}`;

/** Put the log-writing program in the image. Before the start command, which runs it. */
export function writeDevServerLogCap(t: TemplateBuilder): TemplateBuilder {
  return t.runCmd(`cat > ${DEV_SERVER_LOG_CAP_PATH} <<'EOF'\n${DEV_SERVER_LOG_CAP_AWK}EOF`);
}

/** What adding a backend installs. Same range `migrateTemplate` writes. */
export const BACKEND_PACKAGES = "hono@^4";

/** What adding a database installs. Same set as `writeDbStack`. */
export const DATABASE_PACKAGES =
  "drizzle-orm @electric-sql/pglite drizzle-zod @hono/zod-validator";

/**
 * Download the backend and database packages into Bun's global install cache
 * without adding them to the app.
 *
 * The base image is frontend-only, but an app can grow a server or a database
 * later, in place. Installing into a throwaway directory leaves the tarballs in
 * `~/.bun/install/cache`, so that later `bun add` links from disk instead of
 * waiting on the registry mid-conversation — while the app's own
 * `package.json` keeps listing only what the app actually uses.
 */
export function warmBackendPackages(t: TemplateBuilder): TemplateBuilder {
  return t.runCmd(
    `mkdir -p /tmp/tau-warm && cd /tmp/tau-warm && echo '{}' > package.json && bun add ${BACKEND_PACKAGES} ${DATABASE_PACKAGES} && cd / && rm -rf /tmp/tau-warm`,
  );
}

/** ripgrep, for searching a project without reading it file by file. */
export function installSearchTools(t: TemplateBuilder): TemplateBuilder {
  return t.aptInstall(["ripgrep"], { noInstallRecommends: true });
}

/**
 * Write `.tau/CONTEXT.md` — the per-app memory tau carries across runs.
 *
 * Generation 1 put a template manifest above a DYNAMIC marker and the app's
 * state below it. The manifest half duplicated the system prompt and could only
 * be changed by rebuilding the image, so here the file is app memory and
 * nothing else: there is no static section and no marker.
 */
export function writeAppMemory(t: TemplateBuilder): TemplateBuilder {
  return t.runCmd(
    `mkdir -p .tau && cat > .tau/CONTEXT.md <<'EOF'\n${buildAppMemoryMd()}EOF`,
  );
}

/** The empty app-memory file, ending in a newline. */
export function buildAppMemoryMd(): string {
  return `# App memory

<!-- tau keeps this file current. Rewrite a section when it changes; do not
     append a log. Keep the whole file short enough to read in one go. -->

## What this app is
_Nothing built yet._

## Routes and where they live
_None yet._

## Data model
_None yet._

## Decisions and why
_None yet._

## User preferences
_None yet._

## Known issues
_None yet._
`;
}
