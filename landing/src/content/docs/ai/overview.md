---
title: AI gateway overview
description: The app tau builds you can call an LLM — no SDK, no key of your own, billed to the same credits.
section: ai
order: 1
updated: 2026-07-30
---

> [!NOTE]
> **Beta.** Every piece of the gateway is built and shipped, but the whole path —
> asking tau to build an AI app and running it end to end — has not been driven
> yet. Expect it to work; report it if it doesn't.

Ask tau to add AI to your app and it wires it up. You do not sign up for a model
provider, you do not obtain an API key, and you do not install an SDK.

## What tau does for you

1. **Mints you a credential** — one `tau_sk_live_…` key per account.
2. **Injects it into the sandbox** — as `TAU_API_KEY`, alongside `TAU_AI_URL`,
   re-injected on every provision so it survives a rebuild.
3. **Serves the inference itself** — your app calls tau, tau calls the model.
4. **Bills it to your credits** — as *runtime* spend, shown separately from build
   spend.

```text
your app  ──fetch──▶  tau gateway  ──▶  model
   │                       │
   │                       └── metered → your credits (runtime spend)
   └── needs only TAU_AI_URL + TAU_API_KEY from the environment
```

## Two dialects, one credential

| Surface | Shape | Use it for |
|---|---|---|
| `/ai/chat`, `/ai/chat/stream` | A small task-shaped JSON dialect | What your generated app uses. Plain `fetch`, no SDK. |
| `/v1/chat/completions`, `/v1/models` | OpenAI-compatible | Pointing an existing OpenAI SDK at tau from outside the sandbox. |

Same key, same limits, same metering. The split exists so a generated app needs
nothing installed, while an existing codebase can keep its SDK.

→ [Chat API](/docs/ai/chat-api) · [OpenAI-compatible API](/docs/ai/openai-compatible)

## Model aliases, not vendor names

You ask for `tau-fast`, `tau-smart` or `tau-max` — never a vendor model id.

| Alias | What it is |
|---|---|
| `tau-fast` | Fastest and cheapest. Good default for most app features. |
| `tau-smart` | Stronger reasoning at a higher per-token cost. |
| `tau-max` | Most capable. Falls back to `tau-smart` when unconfigured. |

The indirection is deliberate: a deployed app bakes whatever string it was given
into its source. If tau exposed `deepseek-v4-flash` directly, every app would
break the day tau changed provider. Aliases let the mapping move underneath you.

An unknown model name is a `400`, not a silent substitution.

## What it costs

Runtime inference is metered on the same credits that pay for builds, at the same
per-token rates as the underlying model.

It is tracked and shown **separately** from build spend, so "the agent working on
my project" and "my app answering its users" are never conflated on your billing
page.

→ [Gateway billing](/docs/ai/billing)

## The caps that protect you

A deployed app's endpoints are public. Someone could hammer yours. Four limits
bound what that can cost you:

| Limit | Default |
|---|---|
| Daily spend per key | 20 credits |
| Requests per minute per key | 60 |
| Concurrent requests per key | 8 |
| Max output tokens per request | 4096 |

The daily cap is the important one, and you can change it. It resets at 00:00
UTC.

→ [API keys](/docs/ai/api-keys) · [Limits](/docs/billing/limits)

## Next

- [Quickstart](/docs/ai/quickstart) — ask tau to add AI, and see what it wires up
- [API keys](/docs/ai/api-keys)
- [Chat API](/docs/ai/chat-api)
