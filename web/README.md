# web

The Tau SPA: prompt composer, live agent chat, file tree, in-browser code editor,
preview pane, and billing. Vite + React 19 + TypeScript, TanStack Query,
Zustand, Tailwind, CodeMirror 6.

Uses **pnpm**. `api`/`worker-service`/`cli` use bun and `mobile` uses npm: don't
cross them.

```bash
pnpm install
pnpm dev        # vite dev server on http://localhost:5174
pnpm build      # tsc -b && vite build
pnpm lint
```

## Environment

`VITE_API_URL`: the API origin, if it isn't on the default host.

`VITE_LANDING_URL`: the public site origin. Production defaults to
`https://tauai.pro`; local development defaults to `http://localhost:5173`.

`VITE_WS_URL` is **gone**. Live streaming rides the api origin over SSE
(`GET /jobs/:jobId/stream?lastEventIndex=N`, with replay); there is no WebSocket
anymore.

## Layout

```
src/
  pages/        route components (Home, Login, Billing, Checkout, …)
  features/
    account/    API-key card + the re-auth dialog
    auth/       login/signup/verify, OAuth callback
    billing/    balance, packs, ledger, spend split, subscription
    composer/   prompt box + attachments (pick → hash → presigned PUT → complete)
    home/       authenticated home visuals
    project/    the IDE: ChatPanel, CodePane, PreviewPane, GithubPanel, RightPanel
    settings/
  stores/       zustand: useProjectStore.ts is the big one
  components/   shared primitives
  lib/          api-client, env, utils
  hooks/
```

`pages/Checkout.tsx` exists for **mobile**, not for web users: Razorpay *orders*
have no hosted page the way *subscriptions* do, so the mobile app opens this
route in an in-app browser tab to run Checkout JS, then deep-links back to
`tau://`. Don't delete it as unused.

## Two things worth knowing before you change the chat

**The transcript is rebuilt by two independent reducers.** `toConversation()`
replays persisted rows on load; `applyEvent()` folds live SSE events. They must
stay in lockstep, and historically they did not: that drift produced three
reload/navigation bugs (`doc/archive/PROJECT_CHAT_FETCH_RELIABILITY.md`). They
were **reconciled, not unified**, so the structural risk is still there. If you
touch one, check the other. Both now have a third porting in `mobile/`.

**Attachment uploads use bare `fetch`, not the axios instance**
(`features/composer/attachments/api.ts:21`). The interceptor's `Authorization`
header breaks the R2 presigned-PUT signature. This is the easiest thing to get
wrong here. R2 also needs a CORS rule allowing `PUT` from `APP_URL` -
`deploy/r2-cors.json`, applied in the Cloudflare dashboard: or every upload
preflight 403s.

## Related

`mobile/` is a native port of this app with deliberately parallel structure
(`web/src/features/*` ↔ `mobile/src/features/*`). The shared wire types are
asserted string-identical by `bun run check:mobile` from the repo root; run it
after changing anything in `features/*/types.ts`.

There are **no tests** in `web/`. See `doc/PRODUCTION_READINESS.md`.
