---
title: OpenAI-compatible API
description: POST /v1/chat/completions and GET /v1/models: point an existing OpenAI SDK at tau.
section: ai
order: 5
updated: 2026-07-30
---

The `/v1` surface speaks OpenAI's dialect, so an existing SDK works with a base
URL change and nothing else.

**Base URL:** `https://api.usetau.dev/v1`
**Auth:** `Authorization: Bearer $TAU_API_KEY`: the same
[`tau_sk_live_…` key](/docs/ai/api-keys).

## When to use this instead of /ai

Use `/v1` when you already have code built around the OpenAI SDK and want it to
run on tau's credits.

Use [`/ai/chat`](/docs/ai/chat-api) for an app tau built you. It needs no
dependency at all, which is why it is what tau wires in by default.

## With the OpenAI SDK

```ts
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.TAU_API_KEY,
  baseURL: "https://api.usetau.dev/v1",
});

const completion = await client.chat.completions.create({
  model: "tau-fast",
  messages: [{ role: "user", content: "Summarise this: ..." }],
});

console.log(completion.choices[0].message.content);
```

Streaming works too:

```ts
const stream = await client.chat.completions.create({
  model: "tau-smart",
  messages,
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
}
```

## Models

Aliases only: `tau-fast`, `tau-smart`, `tau-max`. Not vendor model ids.

An unknown name is a `400` with code `model_not_found` listing the valid
aliases. It is an allowlist, not a passthrough.

```bash
curl https://api.usetau.dev/v1/models \
  -H "Authorization: Bearer $TAU_API_KEY"
```

```json
{
  "object": "list",
  "data": [
    { "id": "tau-fast", "object": "model", "owned_by": "tau", "description": "..." },
    { "id": "tau-smart", "object": "model", "owned_by": "tau", "description": "..." },
    { "id": "tau-max", "object": "model", "owned_by": "tau", "description": "..." }
  ]
}
```

`/models` sits behind the key check as well. It reveals nothing sensitive, but
leaving it open would make the gateway enumerable for no benefit to a legitimate
caller.

## Supported parameters

| Parameter | Behaviour |
|---|---|
| `model` | Required in practice; defaults to `tau-fast`. Alias only |
| `messages` | Required, non-empty |
| `stream` | Supported. Must be a boolean |
| `max_tokens` / `max_completion_tokens` | **Clamped** to 4096, not rejected |
| `temperature`, `top_p`, `stop`, `seed` | Passed through |
| `tools`, `tool_choice` | Passed through |
| `response_format` | Passed through: use it for JSON mode |
| `n` | Must be `1` |

Two of these are worth reading twice.

**`max_tokens` is clamped, not rejected.** The ceiling exists to bound cost, and
failing a request outright over it would be less useful than serving it within
the limit.

**`n` must be 1.** More than one completion multiplies output tokens against a
cap sized for one, so the cost bound would stop holding.

## Response headers

| Header | Notes |
|---|---|
| `x-tau-request-id` | Correlates a call with its usage record |
| `x-tau-credits-remaining` | Balance after the call. Non-streaming only |

The balance is not known until a stream closes, and headers are long gone by
then: so streaming responses carry the request id but not the balance.

## Errors

`/v1` returns OpenAI's error envelope, because the SDK parses this exact shape to
decide whether a failure is a `BadRequestError`, a `RateLimitError`, an
`AuthenticationError`, and so on:

```json
{
  "error": {
    "message": "Daily spend cap reached (20 credits). It resets at 00:00 UTC, ...",
    "type": "rate_limit_error",
    "code": "daily_cap_exceeded",
    "param": null
  }
}
```

| Status | `type` | `code` |
|---|---|---|
| 400 | `invalid_request_error` | `invalid_messages`, `model_not_found`, `invalid_n`, `invalid_stream` |
| 401 | `invalid_request_error` | `invalid_api_key` |
| 402 | `insufficient_quota` | `insufficient_credits` |
| 429 | `rate_limit_error` | `rate_limit_exceeded`, `concurrency_limit_exceeded`, `daily_cap_exceeded` |
| 503 | `api_error` | `model_unavailable` |

> [!NOTE]
> An error that happens **after** streaming headers are flushed cannot become a
> 4xx: the status code is already spent. It goes out as an SSE error frame,
> which the SDK parses mid-stream, rather than as a silent truncation your app
> would read as a short answer.

## Limits

The same limits as `/ai`: they are one gateway with two dialects. 60 requests
per minute per key, 8 concurrent, a 20-credit daily cap by default, 4096 output
tokens per request.

→ [API keys](/docs/ai/api-keys) · [Limits](/docs/billing/limits)

## Next

- [Chat API](/docs/ai/chat-api): the dialect tau wires in by default
- [Gateway billing](/docs/ai/billing)
- [Errors](/docs/reference/errors)
