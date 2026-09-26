---
title: Errors
description: Every error code tau returns, in plain words, with what to do about it.
section: reference
order: 3
updated: 2026-07-30
---

Errors you can hit, what each one means, and the fix.

## Builds and projects

### `INSUFFICIENT_CREDITS` — 402

Your balance is too low to start a build. Tau refuses up front rather than
starting one that dies immediately.

**Fix:** buy a [credit pack](/docs/billing/credit-packs), redeem a
[promo code](/docs/billing/promo-codes), or upgrade to
[PRO](/docs/billing/plans).

### `CONCURRENT_JOB_LIMIT` — 429

You already have a build running. One job at a time per account.

**Fix:** wait for it, or cancel it. There is also a cancel-all.

This is deliberate — every build has a real sandbox and a real spend cap behind
it, and letting one account run several is how a balance empties by accident.

### `PROJECT_LIMIT_REACHED` — 403

Free accounts hold 3 projects at a time. You have 3.

**Fix:** delete one you are done with — push it to GitHub first, deletion is not
reversible — or upgrade to PRO for unlimited projects.

### 409 on a file save

The file changed since you opened it, usually because the agent rewrote it. The
save was refused rather than overwriting.

**Fix:** reopen the file, look at the current version, reapply your change. The
refusal protected an edit you would otherwise have lost.

→ [Files and the editor](/docs/workspace/files-and-editor)

### Editing blocked while a job runs

Not an error so much as a rule: you cannot save while the agent is working on the
project.

**Fix:** wait for the job, or cancel it.

## Why a build ended

Every job ends with a reason, shown in the chat.

| Reason | Meaning | What to do |
|---|---|---|
| Finished | Tau considers it done | Look at it; follow up |
| Cancelled | You stopped it | Re-prompt with what was missing |
| Out of turns | Hit its tier's agent-turn budget | Follow up, or use a higher tier |
| Out of wall clock | Hit its tier's time limit | Usually something wedged; retry |
| Out of credits | Hit the spend cap or your balance | Top up, then follow up |
| Failed | Something broke | [Troubleshooting](/docs/help/troubleshooting) |

None of these lose your files. A follow-up continues from where it stopped.

## AI gateway — `/ai/*`

Flat JSON: `{ "error": "...", "code": "..." }`.

| Status | `code` | Meaning | Fix |
|---|---|---|---|
| 400 | `missing_prompt` | Neither `prompt` nor `messages` | Send one of them |
| 400 | `ambiguous_prompt` | Both `prompt` and `messages` | Send one, not both |
| 400 | `invalid_system` | `system` was not a string | Send a string |
| 401 | `invalid_api_key` | Missing, wrong, or revoked key | Check `TAU_API_KEY`; it may have been rotated past its grace window |
| 402 | `insufficient_credits` | The account is out of credits | Top up |
| 429 | `rate_limit_exceeded` | Over 60 requests/minute | Back off and retry |
| 429 | `concurrency_limit_exceeded` | Too many in flight | Retry shortly |
| 429 | `daily_cap_exceeded` | Over the key's daily cap | Wait for 00:00 UTC, or raise the cap |
| 500 | `internal_error` | Tau-side failure | Retry; report it if it persists |

## AI gateway — `/v1/*`

OpenAI's envelope, because the SDK parses this shape to pick an exception class:

```json
{
  "error": {
    "message": "...",
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

### `model_not_found`

You asked for a vendor model id. The gateway takes **aliases** only: `tau-fast`,
`tau-smart`, `tau-max`. The message lists them.

### `invalid_n`

`n` must be 1. More than one completion multiplies output tokens against a cap
sized for one, so the cost bound would stop holding.

### `stream_timeout`

A single stream is stopped after 5 minutes. On `/ai/chat/stream` this arrives as a
frame with `done: true`, `error` and `code` — which is why the contract is *read
frames until `done`* rather than *read until the socket closes*.

## Attachments

| Problem | Meaning | Fix |
|---|---|---|
| File too large | Over 10 MB, or over 5 MB for an image | Compress it, or attach a smaller excerpt |
| Too many attachments | Over 5 on one message | Split across messages |
| Attachment has no content | You sent while it was still extracting | Wait for **Ready**, then send |

## Handling errors in your generated app

Every gateway error has a stable `code`. Branch on it rather than on the message:

```ts
const res = await fetch(`${process.env.TAU_AI_URL}/chat`, { /* ... */ });

if (!res.ok) {
  const { code } = await res.json();
  if (code === "insufficient_credits" || code === "daily_cap_exceeded") {
    return { error: "AI features are temporarily unavailable." };
  }
  if (code === "rate_limit_exceeded") return retryAfter(2000);
  throw new Error(code);
}
```

## Next

- [Troubleshooting](/docs/help/troubleshooting)
- [Limits](/docs/billing/limits)
- [Contact](/docs/help/contact)
