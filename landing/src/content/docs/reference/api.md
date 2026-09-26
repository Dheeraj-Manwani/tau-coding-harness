---
title: HTTP API
description: The public HTTP surface is the AI gateway. Everything else is tau's own app API, and not a stable contract.
section: reference
order: 5
updated: 2026-07-30
---

Tau has one public, documented, credential-authenticated HTTP surface: the
**AI gateway**. That is the API you can build against.

## The public surface

**Base:** `https://api.usetau.dev`
**Auth:** `Authorization: Bearer $TAU_API_KEY` — your
[`tau_sk_live_…` key](/docs/ai/api-keys).

| Method | Path | What it does |
|---|---|---|
| `POST` | `/ai/chat` | One prompt in, one string out |
| `POST` | `/ai/chat/stream` | The same, as SSE text deltas |
| `GET` | `/ai/models` | The alias catalog, plain shape |
| `POST` | `/v1/chat/completions` | OpenAI-compatible, streaming supported |
| `GET` | `/v1/models` | OpenAI-compatible model list |

Full request and response shapes:

- **→ [Chat API](/docs/ai/chat-api)** — the `/ai` dialect
- **→ [OpenAI-compatible API](/docs/ai/openai-compatible)** — the `/v1` dialect

Both dialects share one credential, one set of limits and one metering path. They
differ only in wire format.

### Optional headers

| Header | Purpose |
|---|---|
| `X-Tau-Project: <projectId>` | Attribute the usage to a project on your billing page |

### Response headers

| Header | Notes |
|---|---|
| `x-tau-request-id` | Correlates a call with its usage record |
| `x-tau-credits-remaining` | Balance after the call. Non-streaming `/v1` only |

## There is no build API

You cannot start a build, create a project, or read a transcript over HTTP with an
API key. There is no programmatic way to drive tau itself.

Tau's own endpoints — projects, messages, files, billing — exist, and your browser
and the mobile app use them. They authenticate with a **session**, not with your
API key, and they are not a public contract:

- They are not versioned.
- They change without notice, including in breaking ways.
- They are shaped for tau's own clients, not for third parties.

> [!WARNING]
> Do not build against them. Anything you write will break, and the breakage will
> not be announced because there is nothing to announce it to.

If you want to automate tau, say so — [contact us](/docs/help/contact). Knowing
what people would automate is what decides whether a real API gets built.

## Webhooks

None available to you. Tau receives webhooks from its payment processor; it does
not send any.

## Rate limits

The gateway limits, per key:

| Limit | Default |
|---|---|
| Requests per minute | 60 |
| Concurrent requests | 8 |
| Daily spend cap | 20 credits |
| Max output tokens per request | 4096 |
| Single stream wall clock | 5 minutes |

Exceeding any of the first three returns `429` with a specific `code`. There is
also a process-wide concurrency ceiling; hitting it returns `429` asking you to
retry shortly.

→ [Limits](/docs/billing/limits) · [Errors](/docs/reference/errors)

## Versioning

`/v1` is the OpenAI-compatible surface's name, not a tau version number. Both
dialects are stable in the sense that breaking either would break deployed apps —
which is exactly why models are exposed as
[aliases](/docs/ai/overview) rather than vendor ids.

## Next

- [Chat API](/docs/ai/chat-api)
- [API keys](/docs/ai/api-keys)
- [Errors](/docs/reference/errors)
