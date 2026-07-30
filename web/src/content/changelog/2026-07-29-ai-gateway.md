---
title: Your generated app can call an LLM
date: 2026-07-29
---

Ask tau to add AI to your app and it wires it up — no SDK, no provider account,
and no API key of your own.

- **One credential per account.** A `tau_sk_live_…` key, encrypted at rest,
  injected into your sandbox as `TAU_API_KEY` and re-injected on every provision
  so it survives a rebuild.
- **Two dialects, one key.** `/ai/chat` and `/ai/chat/stream` for a plain `fetch`
  from the app tau built you; `/v1/chat/completions` for pointing an existing
  OpenAI SDK at tau.
- **Metered separately.** Gateway calls bill as *runtime* spend, shown apart from
  build spend on your billing page.
- **Caps that protect you.** A per-key daily spend cap — 20 credits by default,
  configurable — plus rate and concurrency limits, because a deployed app's
  endpoints are public.
- **Rotation with a 24-hour grace window**, so rotating a key does not break
  every deploy the instant you click it. Revealing or rotating requires
  re-authentication.

Also: **mobile OAuth**. Sign in with Google or GitHub from the app.

→ [AI gateway overview](/docs/ai/overview)
