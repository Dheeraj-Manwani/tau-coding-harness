---
title: Limits
description: Every cap in tau, in one table.
section: billing
order: 5
updated: 2026-08-27
---

Every limit tau enforces, in one place. These are the defaults the service runs
with.

## Credits and plans

| Limit | Value |
|---|---|
| Free signup grant | 20 credits, one time, never refilled |
| PRO monthly allotment | 5,000 credits per billing cycle |
| Plan credit expiry | End of the billing cycle |
| Free and bonus credit expiry | Never |
| Minimum available balance to start a build | 1 credit |
| Spend order | free → plan → bonus |

## Projects and jobs

| Limit | Value |
|---|---|
| Projects at a time (Free) | 3 |
| Projects at a time (PRO) | Unlimited |
| Concurrent jobs per account | 1 |

Concurrency is per account, not per project. Starting a second build while one
runs is refused with a clear message rather than queued.

## Per build, by effort tier

| | **Low** | **High** | **Max** |
|---|---|---|---|
| Model | DeepSeek (flash) | DeepSeek (pro) | DeepSeek (pro) |
| Agent turns | 80 | 200 | 300 |
| Sub-agent turns | 20 | 40 | 60 |
| Parallel sub-agents | 1 | 3 | 5 |
| Wall clock | 20 min | 45 min | 90 min |
| Spend cap per build | 5,000 credits | 25,000 credits | 50,000 credits |

The spend cap is a ceiling, not a price. A small build on Max costs what it
costs.

→ [Effort tiers](/docs/build/effort-tiers)

## Attachments

| Limit | Value |
|---|---|
| Max file size | 10 MB |
| Max image size | 5 MB |
| Max attachments per message | 5 |

→ [Attachments](/docs/build/attachments)

## AI gateway, per key

| Limit | Value |
|---|---|
| Daily spend cap | 20 credits (configurable, up to 100,000) |
| Daily cap reset | 00:00 UTC |
| Requests per minute | 60 |
| Concurrent requests | 8 |
| Max output tokens per request | 4096 |
| Minimum balance to serve a request | 0.1 credits |
| Single stream wall clock | 5 minutes |
| Rotation grace window | 24 hours |

There is also a process-wide concurrency ceiling across every key, so runtime
inference cannot starve builds. Hitting it returns a `429` asking you to retry.

→ [API keys](/docs/ai/api-keys) · [Gateway billing](/docs/ai/billing)

## Context

A build has a token budget for its conversation. As it approaches the limit, tau
compacts the history — trimming old tool output and summarising earlier turns —
rather than failing.

You will not normally notice. On a very long build, the effect is that tau
remembers the shape of what it did earlier in more detail than the exact text.

> [!TIP]
> If a long build starts forgetting a constraint you set at the beginning, restate
> it in a follow-up. That is cheaper than fighting it.

## What has no limit

- **Follow-up messages per project.** As many as you like.
- **Total projects ever created.** The cap is on projects you currently hold.
- **Total credits you can buy.**
- **Effort tiers by plan.** Every tier is open on every plan.

## No uptime guarantee

Tau does not publish an SLA and does not offer an uptime guarantee. A service
restart can drop an in-flight build; you are not charged for work that did not
happen, but you will need to resubmit.

## Next

- [Errors](/docs/reference/errors) — what each refusal looks like
- [Credits](/docs/billing/credits)
- [Effort tiers](/docs/build/effort-tiers)
