# tau landing

Public site for `https://tauai.pro`: marketing, pricing, changelog, legal pages,
and documentation.

```bash
pnpm install
pnpm dev
pnpm build
```

The production app origin defaults to `https://app.tauai.pro`. Set
`VITE_APP_URL` to override it (the local default is `http://localhost:5174`).

Run `bun run scripts/prerender.ts` after a build to write static HTML for public
routes. `SITE_ORIGIN` overrides the canonical origin used by the sitemap and
prerenderer.
