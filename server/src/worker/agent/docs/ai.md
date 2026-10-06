# AI guide — calling a language model from the app

This works only after `enable_ai` has been called for the app. That call is what puts the credentials in the server's environment; reading this guide does not.

Call the model with plain `fetch` from your SERVER code. There is NO package to install and no client library to set up.

In `server/index.ts`:

```ts
app.post('/api/ask', async (c) => {
  const { question } = await c.req.json<{ question: string }>()

  const res = await fetch(`${process.env.TAU_AI_URL}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.TAU_API_KEY}`,
      'X-Tau-Project': process.env.TAU_PROJECT_ID ?? '',
    },
    body: JSON.stringify({
      prompt: question,
      system: 'You are a helpful assistant. Be concise.',
    }),
  })

  const data = await res.json()
  if (!res.ok) return c.json({ error: data.error }, 502)
  return c.json({ answer: data.text })
})
```

The frontend calls YOUR route (`fetch('/api/ask', …)`) — never tau directly, and never with the key.

Keep the `X-Tau-Project` header on every call. It is what attributes this app's AI spend to this project on the user's billing page; without it their usage shows up unattributed. It carries no secret — copy it as written.

## Request
Only `prompt` is required.

| Field | Type | |
|---|---|---|
| `prompt` | string | the question or instruction |
| `system` | string | optional persona or rules |
| `messages` | array | optional, instead of `prompt`, for multi-turn chat: `[{ role, content }]`, where `role` is `'user'`, `'assistant'` or `'system'` |
| `model` | string | `'tau-fast'` (default), `'tau-smart'` or `'tau-max'` |
| `maxTokens` | number | optional output limit. Leave it unset unless you have a reason — set too low it returns an empty answer, because these models think before they write |
| `temperature` | number | optional |
| `json` | `true` | optional — makes the model reply with valid JSON |

## Response
`{ text, model, finishReason, truncated, usage: { inputTokens, outputTokens, creditsSpent, creditsRemaining }, requestId }`

The answer is `data.text`. `truncated` is true if the model ran out of room mid-answer — raise `maxTokens` or ask for something shorter.

## Errors
Errors come back as `{ error: string, code: string }` with a non-2xx status:

- `insufficient_credits` (402) — the owner is out of credits
- `daily_cap_exceeded` (429) — the owner's daily AI spend limit was hit
- `rate_limit_exceeded` (429) — too many requests just now

Show a friendly message for these. Never surface a raw error to the user.

## Streaming
Only if the UI needs text to appear progressively: POST the same body to `${process.env.TAU_AI_URL}/chat/stream`. It returns server-sent events, one JSON object per `data:` line: `{"text":"…"}` for each piece, then a final frame carrying `"done":true`. Read frames until you see `done` — that frame also carries `error` / `code` if the stream ended badly, so handle both on the same frame. Prefer the plain `/chat` endpoint unless streaming genuinely improves the experience; it is much simpler to get right.

## Rules
- NEVER put `TAU_API_KEY` in frontend code, in a file, or in a log line. It is already in the environment; just read `process.env`.
- Do NOT install or import an AI SDK (`openai`, `@anthropic-ai/sdk`, …) and do NOT ask the user for an API key. This `fetch` is the whole integration.
- Do not call OpenAI, Anthropic or Gemini endpoints directly. `enable_ai` is how this app gets AI.
- Your `/api` route is public once deployed. Keep prompts small and consider a simple per-IP rate limit, because every call spends the owner's credits.
