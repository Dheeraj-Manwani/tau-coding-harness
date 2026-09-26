---
title: Credits
description: What a credit is, the three buckets, the order they are spent in, and how to read your ledger.
section: billing
order: 1
updated: 2026-07-30
---

A credit is the unit of work. Everything tau does for you is metered in credits:
every model call on a build, and every call your generated app makes through the
[AI gateway](/docs/ai/overview).

## What a credit buys

Credits are consumed per token, at a rate that depends on which model ran. A
higher effort tier uses a more expensive model, so the same amount of work costs
more on Max than on Low.

For a sense of scale:

| | Roughly |
|---|---|
| A small landing page | Varies with model tokens and effort; watch the live balance while it runs |
| A working app with a few screens | 15–40 credits |
| A one-line follow-up change | Well under a credit |
| A short gateway call from your app | A small fraction of a credit |

These are observed ranges, not prices. A build costs what it costs; the
[spend cap](/docs/build/effort-tiers) is the ceiling, not the bill.

> [!NOTE]
> Credits are tracked finely: to a millionth of a credit internally: so a
> cheap call is genuinely cheap rather than rounded up to 1.

## Where they come from

**300 free credits at signup.** One time, never refilled. Enough for several small
builds.

**5,000 credits per cycle on PRO.** Granted on your billing date each month.

**Credit packs.** Top up any time, no subscription required.

**Promo codes.** Redeemable on your billing page.

→ [Plans](/docs/billing/plans) · [Credit packs](/docs/billing/credit-packs) · [Promo codes](/docs/billing/promo-codes)

## The three buckets

Your balance is not one number. It is three, and they expire differently:

| Bucket | Source | Expiry |
|---|---|---|
| **Free** | The one-time signup grant | Never |
| **Plan** | Your PRO monthly allotment | End of the billing cycle |
| **Bonus** | Credit packs and promo codes | Never |

## Spend order: free → plan → bonus

Credits are always spent in that order: soonest-to-expire first.

This is the order that loses you the least. Plan credits vanish at the end of the
cycle whether you use them or not, so they are spent before the bonus credits you
paid for. Free credits go first because they cost you nothing.

The practical upshot: a PRO subscriber who buys a pack will not see the pack
drained while their monthly allotment sits unused.

## Two kinds of spend

| | What it is |
|---|---|
| **Build spend** | The agent working on your project |
| **Runtime spend** | Your finished app calling the AI gateway |

Both draw on the same balance and are shown separately on your billing page. The
split matters because one is something you did and the other is something your
app's traffic did.

→ [Gateway billing](/docs/ai/billing)

## Reading your ledger

Your billing page shows:

- **Balance**, broken down by bucket.
- **The spend split**: build versus runtime.
- **A ledger**: every grant, purchase, redemption and debit, in order.

Every entry has a reason. If a number looks wrong, the ledger is where the answer
is, and it is worth reading before assuming a bug.

## What happens when you run out

A build stops **cleanly**. Whatever was written is on disk and in storage, the job
ends with a clear reason, and nothing about your project is left broken.

You are charged for the work that happened, not for the turns that never ran.

Gateway calls start failing with `402` and code `insufficient_credits`, so a
deployed app's AI features degrade rather than crashing.

To continue: buy a pack, redeem a code, or upgrade to PRO. Then send your
follow-up: the project picks up where it stopped.

> [!TIP]
> A build refuses to start below a minimum available balance rather than starting
> and dying immediately. If a build will not start, check your balance first.

## Refunds

Credits are consumed as work is done, so a spent credit is not refundable. See
[Refunds](/docs/billing/refunds).

## Next

- [Plans](/docs/billing/plans)
- [Limits](/docs/billing/limits): every cap in one table
- [Effort tiers](/docs/build/effort-tiers)
