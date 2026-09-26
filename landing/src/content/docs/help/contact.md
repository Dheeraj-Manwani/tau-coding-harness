---
title: Contact
description: How to reach a human, and what to include so the first reply is useful.
section: help
order: 3
updated: 2026-07-30
---

**[support@usetau.dev](mailto:support@usetau.dev)**

That is the address. There is no ticket portal and no chatbot in front of it.

## Before you write

Two pages answer most questions faster than an email round-trip:

- **[Troubleshooting](/docs/help/troubleshooting)**: the things that go wrong, in
  order of how often.
- **[FAQ](/docs/help/faq)**: what tau does and doesn't do.

If it is a billing question, your ledger is worth reading first. Every entry has a
reason, and the two most common surprises: a Max build costing more than expected,
and runtime spend from a deployed app: both show up there plainly.

## What to include

The difference between a one-email resolution and four is usually these five
things:

1. **What you expected, and what happened.** In that order.
2. **The project**, if it is about a specific build. Its name is enough.
3. **Roughly when.**
4. **The exact error**, if there was one: the message and its `code`.
5. **The relevant ledger entries**, for anything about credits.

For a gateway problem, the `x-tau-request-id` from the response header is the
single most useful thing you can send. It identifies the exact call.

## What we can do

**Fix credits.** If work failed for a reason on tau's side, that gets made right -
usually with credits, which is faster and cleaner than a payment reversal.

**Look at a specific build.** With a project and a rough time, a run can be traced
end to end.

**Delete your account and data.** Email the address above; deletion completes
within 30 days. See the [Privacy Policy](/privacy).

**Take a feature request.** Especially: what you would automate if there were an
API, and what you tried to build that tau could not. Both directly shape what gets
built.

## What we can't do

**Refund consumed credits.** A spent credit paid for work that was done. See
[Refunds](/docs/billing/refunds).

**Deploy your app.** Not built. [GitHub is the route out](/docs/ship/deploying).

**Recover a deleted project.** Deletion is not reversible and there are no
checkpoints. Push to GitHub before deleting anything you might want.

**Promise an uptime figure.** There is no SLA.

## Reporting a security issue

Email the same address with **SECURITY** in the subject. Please do not open a
public issue for anything exploitable.

If you have found a way to read another user's project, spend someone else's
credits, or get inference without being metered, that is worth telling us about
directly and promptly.

## Next

- [Troubleshooting](/docs/help/troubleshooting)
- [FAQ](/docs/help/faq)
- [Refunds](/docs/billing/refunds)
