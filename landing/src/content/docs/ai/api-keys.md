---
title: API keys
description: Your tau_sk_* credential: where it lives, how rotation works, the daily cap, and why revealing it needs re-auth.
section: ai
order: 3
updated: 2026-07-30
---

One key per account, used by every app you build. It is what authorises calls to
the [AI gateway](/docs/ai/overview), and it spends your credits.

```text
tau_sk_live_••••••••••••••••••••••••
```

## Where it lives

**In the sandbox**, as `TAU_API_KEY`, injected by tau and re-injected on every
provision: so it survives a rebuild without you doing anything.

**In your account settings**, where you can reveal it, rotate it, revoke it, and
set its daily cap.

**Encrypted at rest** on tau's side (AES-256-GCM), with a separate hashed index
for lookups. Tau does not store it in plain text.

## Revealing it

Revealing is an explicit action that requires **re-authentication**: you confirm
who you are, again, even though you are already signed in.

Two reasons. A page load must never cause a decrypt, and a reveal puts a live
spend credential into an HTTP response and usually onto your clipboard. That
deserves a deliberate step.

Reveals are rate-limited and logged.

> [!WARNING]
> Treat it like a card number. It spends real credits, and a deployed app's
> endpoints are public: a leaked key on a public repo is someone else's budget.

## Rotation

Rotating mints a new key and keeps the old one working for a **24-hour grace
window**.

The window exists because your deployed apps have the old key baked into their
environment. Without it, rotating would break every deploy the instant you
clicked it.

So the sequence is:

1. Rotate. You get the new key; the old one expires in 24 hours.
2. Update `TAU_API_KEY` on every host where you deployed an app.
3. Redeploy.

Tau's own sandboxes pick up the new key automatically on their next provision.

> [!NOTE]
> Rotating does **not** update a deploy you made elsewhere. That is your step, and
> the 24-hour window is the time you have to do it.

## Revoke all

The "it leaked" button. It kills every key immediately, with **no grace window**.

Every deployed app that calls the gateway stops working at once. That is the
point: use it when the alternative is worse.

Afterwards, mint a new key and update your deploys.

## The daily cap

A spend ceiling per key, per day, resetting at **00:00 UTC**. The default is
**20 credits**.

This is the backstop that matters. A deployed app's endpoints are public and
usually unauthenticated, so without a cap one enthusiastic visitor: or one bot -
could drain your balance overnight.

You can change it in settings. Zero disables gateway use entirely; the maximum
you can set is 100,000 credits, so a typo cannot effectively uncap the account.

When the cap is hit, requests get a `429` with code `daily_cap_exceeded` and a
message saying when it resets.

## The other limits

The cap is not the only bound. Per key:

| Limit | Default |
|---|---|
| Requests per minute | 60 |
| Concurrent requests | 8 |
| Max output tokens per request | 4096 |
| Minimum balance to serve a request | 0.1 credits |

There is also a process-wide concurrency ceiling across every key, so runtime
inference cannot starve the builds people are waiting on. Hitting it returns a
`429` asking you to retry shortly.

## Server-side only

Call the gateway from your server. Never from the browser.

A key in front-end code is readable by anyone who opens devtools. There is no
configuration that makes this safe, and no per-origin restriction that saves you.

## Next

- [Chat API](/docs/ai/chat-api)
- [Gateway billing](/docs/ai/billing)
- [Errors](/docs/reference/errors)
