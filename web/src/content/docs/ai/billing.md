---
title: Gateway billing
description: Runtime spend, how it is metered, and why it is shown apart from build spend.
section: ai
order: 6
updated: 2026-07-30
---

Gateway calls are billed to the same credits that pay for builds, at the same
per-token rates as the underlying model — and tracked separately, so the two
never blur together.

## Two kinds of spend

| | What it is | Where it comes from |
|---|---|---|
| **Build spend** | The agent working on your project | Sending a prompt |
| **Runtime spend** | Your finished app calling the gateway | Your app's users |

Your billing page splits them. The distinction matters because they behave
differently: build spend is something you did, and runtime spend is something
your app's traffic did.

Runtime spend is recorded as a gateway debit, separately from build charges, with
one usage record per request.

## How a call is metered

1. **Pre-flight.** Before calling the model, tau checks the rate limit, the
   concurrency limits, your balance, and the key's daily cap. Any of these fails
   the request before a token is spent.
2. **The call happens.**
3. **Metering.** Cost is computed from the tokens the model actually reported,
   and debited in the same transaction that writes the usage record.

> [!NOTE]
> A failed upstream call is **not billed**. There are no usage figures for it and
> you got nothing back.

## What a call costs

Cost is per token, at the rate for whichever model actually served it. Input and
output are priced differently — output is roughly four times input.

For a sense of scale: a short summarise call on `tau-fast` with a few hundred
input tokens and a hundred out is a small fraction of one credit. Credits are
denominated finely enough that per-request cost is meaningful rather than rounded
away.

Every response tells you exactly:

```json
"usage": {
  "inputTokens": 412,
  "outputTokens": 88,
  "creditsSpent": 0.001528,
  "creditsRemaining": 23.41
}
```

`creditsSpent` is what was actually taken, reported by the transaction that took
it — not a figure recomputed afterwards. On a nearly-empty balance those two can
differ, and reporting the recomputed number would bill your app's UI for credits
you were never charged.

If a `tau-max` request degrades to a lower model because the top model is
unavailable, it is metered on the model that actually ran — you are billed at the
lower rate.

## Attribution

Send `X-Tau-Project: <projectId>` and the usage is attributed to that project on
your billing page.

The header is not verified. Checking it would cost a database lookup on the hot
path to stop the key's owner from mis-labelling their own spend, which is not a
problem worth solving. It is attribution, not authorisation.

## The caps

| Cap | Default | What it protects |
|---|---|---|
| Daily spend per key | 20 credits | Your balance, against a public endpoint |
| Requests per minute | 60 | Against a loop in your own code |
| Concurrent per key | 8 | Against one app monopolising capacity |
| Max output tokens | 4096 | The cost of any single request |
| Min balance to serve | 0.1 credits | Against overshooting an empty account |

The daily cap resets at **00:00 UTC** and is the one you should set deliberately.
Your deployed app's endpoints are public — the cap is what turns "someone found
my endpoint" from a billing event into a `429`.

→ [API keys](/docs/ai/api-keys) to change it.

## Running out

When the account behind a key is out of credits, gateway calls fail with `402`
and code `insufficient_credits`. The message tells the caller to top up.

Your app should handle this: branch on the code and show your users something
better than a stack trace.

```ts
if (res.status === 402) {
  return { error: "AI features are temporarily unavailable." };
}
```

Builds and gateway calls draw on the same balance, so a busy app can eat the
credits you were saving for a build. If both matter, set the daily cap low enough
to leave headroom.

## One accounting note

There is a narrow window where a burst of concurrent requests can overshoot a
nearly-empty balance slightly — tau checks the balance before the call and debits
after it. The overshoot is bounded by the per-request token ceiling and the
concurrency limit, and tau absorbs the difference rather than billing you past
zero.

## Next

- [Credits](/docs/billing/credits)
- [Limits](/docs/billing/limits)
- [API keys](/docs/ai/api-keys)
