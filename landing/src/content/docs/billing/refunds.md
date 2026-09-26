---
title: Refunds
description: What is refundable, what isn't, and how to raise a case.
section: billing
order: 6
updated: 2026-07-30
---

The binding terms are in the [Terms &amp; Cancellation Policy](/terms). This page
explains the practical position.

## Consumed credits are not refundable

A credit is spent when work is done: a model call on a build, or a gateway call
from your app. That work has already been paid for on tau's side, so a consumed
credit cannot be returned.

This is why the caps exist. A [per-build spend ceiling](/docs/build/effort-tiers),
a [daily gateway cap](/docs/ai/api-keys) and a one-job-at-a-time limit are all
there so a surprise stays small.

## What you are not charged for

- **Turns that never ran.** Cancel a build and you pay for the work done, not the
  budget.
- **A build lost to a tau-side restart.** The work is gone and so is the charge.
  Resubmit.
- **A failed gateway call.** No usage figures, no charge.

## Subscriptions

Cancel PRO any time from your billing page. Cancelling stops future billing.

Credits already granted for the current cycle stay until the cycle ends, and
expire then: the same as any plan credit.

A part-used cycle is not pro-rated. If you cancel mid-cycle you keep what you have
until the cycle closes.

## Credit packs

An unused pack purchase is a payment question rather than a credit question. If
you bought the wrong pack or bought by mistake and have not spent it,
[contact support](/docs/help/contact): the position depends on the payment
processor's window as much as on ours.

Once spent, the answer is the same as any consumed credit.

## When something went wrong

If credits were spent on work that failed for a reason on tau's side: a build
that broke on our infrastructure, a charge you cannot account for in your ledger -
that is worth raising.

Include:

- **What you expected and what happened.**
- **When**, roughly.
- **The project**, if it is about a specific build.
- **The relevant ledger entries.** Your billing page shows every grant and debit
  with a reason; the entry you are disputing is the useful detail.

Support can make it right with credits. That is usually faster and cleaner than a
payment reversal.

→ [Contact](/docs/help/contact)

## Reading your ledger first

Before raising a case, look at the ledger. Every entry has a reason, and the two
most common surprises have ordinary explanations:

**"I only sent one message and lost a lot of credits."** Check the effort tier. A
Max build uses a more expensive model, and a large first build is the most
expensive thing you will do.

**"My balance dropped while I was not building."** Check the spend split. Runtime
spend is your deployed app calling the [AI gateway](/docs/ai/overview): its
traffic, your credits. That is what the daily cap is for.

## Next

- [Credits](/docs/billing/credits)
- [Limits](/docs/billing/limits)
- [Terms &amp; Cancellation Policy](/terms)
