---
title: What tau can build
description: An honest capability map: what works well, what is harder, and what is out of reach today.
section: build
order: 6
updated: 2026-07-30
---

Tau builds web apps that run in a Linux sandbox with Node and a package manager.
That sentence is the boundary, and most of what follows is a consequence of it.

## What works well

**Front-end apps with real interactivity.** Forms, lists, filters, tables,
dashboards, multi-view apps with client-side routing. This is the centre of the
target and the results are good.

**Small full-stack apps.** An HTTP server alongside the front end: API routes,
request handling, in-process state or a file-backed store.

**Marketing and content pages.** Landing pages, docs-style layouts, pricing
pages. Fast, and cheap on Low.

**Data-shaped tools.** Anything that is "hold these records, show them this way,
let me edit them": trackers, generators, calculators, converters, CRUD tools.

**Apps that call an LLM.** Ask tau to add AI and it wires the
[AI gateway](/docs/ai/overview) in for you: no SDK to install, no key of your
own to obtain. This is genuinely unusual and worth using.

## What is harder

**Large multi-screen products.** Possible, but build it in passes: one screen
per message. One prompt describing eight screens gets you eight shallow ones.

**Heavy persistence.** In-sandbox databases work but the sandbox is modest. An
app whose whole point is a large local database will strain it.

**Pixel-exact reproduction of a design.** Attach a screenshot and you will get
close, and closer with a follow-up. You will not get pixel parity in one shot.

**Anything needing a credential you have not supplied.** Tau cannot sign up for
a third-party API on your behalf. If your app needs a Stripe key, you set it in
the sandbox.

## What is out of reach today

**Deploying to your own domain.** Tau does not publish your app. It builds and
runs it in the sandbox; you push to GitHub and deploy from there. See
[Deploying](/docs/ship/deploying).

**Native mobile apps.** Tau builds for the web. A responsive web app on a phone,
yes; an App Store build, no.

**Pulling changes back from GitHub.** Pushing works. There is no reverse sync -
commits made in your repo do not flow back into the tau project. Treat the push
as an export.

**Downloading a ZIP of your project.** Not built. GitHub is the route out.

**Long-running or scheduled work.** The sandbox exists for the life of the build
and the preview. There is no cron, no queue, no always-on backend hosted by tau.

**Restoring an earlier state.** There are no checkpoints and no restore. Push to
GitHub at points you might want to return to: that is your undo.

## Known limitations worth planning around

**A sandbox is not permanent.** Your files are stored durably and independently,
so nothing is lost, but a preview URL can die and needs **Start preview** to
rebuild one.

**A service restart can drop an in-flight build.** The work is lost and you
resubmit; you are not charged for what did not happen.

**The sandbox is modest.** Roughly a small container. Heavy builds and heavy
in-process databases can exhaust it.

## How to think about the boundary

Tau is strongest when the app is *ordinary web software with an unusual amount of
it written for you*. It is weakest when the value is in infrastructure: hosting,
scheduling, scale, a managed database: because that is the part it does not run.

Build the app in tau. Own the infrastructure yourself, from your repo.

## Next

- [Effort tiers](/docs/build/effort-tiers): how much thinking to buy
- [AI gateway overview](/docs/ai/overview)
- [Deploying](/docs/ship/deploying)
