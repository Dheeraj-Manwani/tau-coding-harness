---
title: AI quickstart
description: Ask tau to add AI to your app, and see exactly what it wires up.
section: ai
order: 2
updated: 2026-07-30
---

The whole setup is one sentence in the chat.

## Ask for it

```text
Add an AI summarise button to each note. Send the note text to a model
and show the summary underneath.
```

You do not need to mention keys, providers or SDKs. Tau recognises that the app
needs inference and wires the gateway in.

## What tau actually does

**Ensures you have a credential.** One `tau_sk_live_…` key per account, minted if
you do not already have one.

**Sets two environment variables in the sandbox**, and re-injects them on every
provision so they survive a rebuild:

```bash
TAU_AI_URL=https://api.usetau.dev/ai
TAU_API_KEY=tau_sk_live_...
```

**Writes the calling code**, server-side, reading both from the environment.

**Records the requirement** in `.tau/deploy.json`, so the variables your app needs
are declared rather than implicit. That file holds only variable *names* — no
secret — so it is safe in your repo.

## The code it writes

Something close to this, on your server:

```ts
// server/index.ts — inside the app tau built for you
const res = await fetch(`${process.env.TAU_AI_URL}/chat`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${process.env.TAU_API_KEY}`,
  },
  body: JSON.stringify({
    prompt: `Summarise this note in two sentences:\n\n${text}`,
  }),
});

const { text: summary } = await res.json();
```

No SDK, no client construction, no provider config. One `fetch`.

> [!WARNING]
> Call the gateway from your **server**, never from the browser. A key in
> front-end code is a key anyone can read and spend your credits with.

## Streaming

For a chat UI you want tokens as they arrive. Same key, one path further:

```ts
const res = await fetch(`${process.env.TAU_AI_URL}/chat/stream`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${process.env.TAU_API_KEY}`,
  },
  body: JSON.stringify({ messages }),
});
```

Frames arrive as `{"text":"…"}` and the last one is
`{"done":true,"usage":{…}}`. Read until `done`.

→ [Chat API](/docs/ai/chat-api) for the full contract.

## Verifying it works

Ask tau to test it, or click the button in the preview. If it fails, the two
usual causes are:

- **Calling from the browser** — move the call to the server.
- **Out of credits or over the daily cap** — check your billing page.

Both produce a clear error with a machine-readable `code`. See
[Errors](/docs/reference/errors).

## When you deploy

The two variables live on the sandbox, not in your repo. Your host needs them
set too:

```bash
TAU_AI_URL=https://api.usetau.dev/ai
TAU_API_KEY=tau_sk_live_...
```

Copy the key from your billing page. Rotating it there does not update a deploy
you made elsewhere — you will need to paste the new one within the grace window.

→ [API keys](/docs/ai/api-keys) · [Deploying](/docs/ship/deploying)

## Next

- [Chat API](/docs/ai/chat-api) — the full request and response shapes
- [API keys](/docs/ai/api-keys) — rotation, the daily cap, re-auth
- [Gateway billing](/docs/ai/billing)
