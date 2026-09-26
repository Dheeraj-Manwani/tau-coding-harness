---
title: Chat API
description: POST /ai/chat and /ai/chat/stream — the full request and response shapes your generated app uses.
section: ai
order: 4
updated: 2026-07-30
---

This is the surface a tau-generated app uses. It needs nothing but `fetch`.

**Base URL:** `TAU_AI_URL` in your environment (`https://api.usetau.dev/ai`).
**Auth:** `Authorization: Bearer $TAU_API_KEY`.

> [!WARNING]
> Server-side only. A key in browser code is a key anyone can spend.

## POST /ai/chat

One prompt in, one string out.

### Request

```json
{
  "prompt": "Summarise this in two sentences: ...",
  "system": "You are terse.",
  "model": "tau-fast",
  "temperature": 0.7,
  "maxTokens": 512,
  "json": false
}
```

| Field | Type | Notes |
|---|---|---|
| `prompt` | string | Provide this **or** `messages`, not both |
| `messages` | array | OpenAI-shaped `{role, content}` array, for multi-turn |
| `system` | string | Optional. Prepended as a system message |
| `model` | string | `tau-fast` (default), `tau-smart`, `tau-max` |
| `temperature` | number | Optional |
| `maxTokens` | number | Optional. Clamped to the server ceiling, not rejected |
| `json` | boolean | `true` asks the model for a JSON object |

Either `prompt` or `messages` is required. Both together is a `400`
(`ambiguous_prompt`); neither is a `400` (`missing_prompt`).

### Response

```json
{
  "text": "The note describes ...",
  "model": "deepseek-v4-flash",
  "finishReason": "stop",
  "truncated": false,
  "usage": {
    "inputTokens": 412,
    "outputTokens": 88,
    "creditsSpent": 0.001528,
    "creditsRemaining": 23.41
  },
  "requestId": "..."
}
```

| Field | Notes |
|---|---|
| `text` | The answer. Never the model's internal reasoning |
| `model` | The upstream model that actually served it |
| `finishReason` | `stop`, `length`, or another provider reason |
| `truncated` | `true` when the model ran out of room mid-answer |
| `usage.creditsSpent` | What was actually debited |
| `usage.creditsRemaining` | Balance after this call |
| `requestId` | Also returned as the `x-tau-request-id` header |

> [!NOTE]
> Reasoning models put their working in a separate field and leave `content`
> empty. `text` is always the answer — tau never hands back the scratch work.

### Example

```ts
const res = await fetch(`${process.env.TAU_AI_URL}/chat`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${process.env.TAU_API_KEY}`,
  },
  body: JSON.stringify({ prompt: text, model: "tau-fast" }),
});

if (!res.ok) {
  const { error, code } = await res.json();
  throw new Error(`${code}: ${error}`);
}

const { text: answer, usage } = await res.json();
```

## POST /ai/chat/stream

Same request body. Responds with Server-Sent Events carrying plain text deltas.

This is deliberately **not** OpenAI's chunk format. An app appending to a chat
bubble wants the next few characters, not to dig them out of
`choices[0].delta.content`.

### Frames

```text
data: {"text":"The "}

data: {"text":"note "}

data: {"text":"describes"}

data: {"done":true,"usage":{"inputTokens":412,"outputTokens":88}}
```

**The rule: read frames until `done`.** Every exit path sends a final frame with
`done: true` — success, a wall-clock timeout, or a mid-flight failure. A failure
frame also carries `error` and `code`:

```json
{
  "error": "The response took longer than 300s and was stopped.",
  "code": "stream_timeout",
  "done": true,
  "usage": { "inputTokens": 412, "outputTokens": 88 }
}
```

A single stream is stopped after 5 minutes as a backstop. That is generous by
design — a limit on runaway streams, not on long answers.

### Example

```ts
const res = await fetch(`${process.env.TAU_AI_URL}/chat/stream`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${process.env.TAU_API_KEY}`,
  },
  body: JSON.stringify({ messages }),
});

const reader = res.body!.getReader();
const decoder = new TextDecoder();
let buffer = "";

for (;;) {
  const { value, done } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });

  const parts = buffer.split("\n\n");
  buffer = parts.pop() ?? "";

  for (const part of parts) {
    if (!part.startsWith("data: ")) continue;
    const frame = JSON.parse(part.slice(6));
    if (frame.text) append(frame.text);
    if (frame.done) return frame.usage;
  }
}
```

## GET /ai/models

```json
{
  "models": [
    { "id": "tau-fast", "description": "Fastest and cheapest. ..." },
    { "id": "tau-smart", "description": "Stronger reasoning ..." },
    { "id": "tau-max", "description": "Most capable. ..." }
  ]
}
```

Behind the key check, like everything else. An unknown alias in a request is a
`400`, not a silent substitution.

## Attributing a call to a project

Send `X-Tau-Project: <projectId>` and the usage is attributed to that project on
your billing page. Optional, and useful when several of your apps share one key.

## Errors

Flat and readable, deliberately unlike `/v1`'s OpenAI envelope — a human or the
agent is reading these out of a `fetch` response:

```json
{ "error": "The tau account behind this API key is out of credits. ...", "code": "insufficient_credits" }
```

| Status | `code` | Meaning |
|---|---|---|
| 400 | `missing_prompt` | Neither `prompt` nor `messages` |
| 400 | `ambiguous_prompt` | Both `prompt` and `messages` |
| 400 | `invalid_system` | `system` was not a string |
| 401 | `invalid_api_key` | Missing, wrong, or revoked key |
| 402 | `insufficient_credits` | The account is out of credits |
| 429 | `rate_limit_exceeded` | Over 60 requests/minute |
| 429 | `concurrency_limit_exceeded` | Too many in flight — retry shortly |
| 429 | `daily_cap_exceeded` | Over the key's daily cap; resets 00:00 UTC |
| 500 | `internal_error` | Tau-side failure |

`code` is stable and machine-usable — branch on `insufficient_credits` to show
your users something better than a stack trace.

## Next

- [OpenAI-compatible API](/docs/ai/openai-compatible)
- [Gateway billing](/docs/ai/billing)
- [API keys](/docs/ai/api-keys)
