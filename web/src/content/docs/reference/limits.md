---
title: Limits
description: A pointer — every cap lives in one table on the billing side.
section: reference
order: 2
updated: 2026-07-30
---

Every limit tau enforces is in one table, and it lives with the billing docs
because most of them are about spend:

**→ [Limits](/docs/billing/limits)**

That page covers:

- Credits, grants, expiry and spend order
- The project cap and job concurrency
- Per-build budgets by effort tier — turns, sub-agents, wall clock, spend cap
- Attachment sizes and counts
- Every AI gateway limit per key
- Context budget behaviour

## Quick answers

| Question | Answer |
|---|---|
| How many free credits? | 25, once, at signup |
| How many projects on Free? | 3 at a time |
| How many builds at once? | 1 per account |
| Biggest attachment? | 10 MB (5 MB for images) |
| Gateway daily cap? | 20 credits by default, configurable |
| Is there an SLA? | No |

## Related

- [Effort tiers](/docs/build/effort-tiers) — the per-build budgets in context
- [Credits](/docs/billing/credits) — buckets and spend order
- [Errors](/docs/reference/errors) — what each refusal looks like when you hit one
