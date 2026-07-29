---
title: Deploying
description: Tau does not deploy your app yet. Here is what to do instead.
section: ship
order: 4
updated: 2026-07-30
---

**Tau does not deploy your app to a domain of your own.** Not yet.

It builds your app and runs it in a sandbox, on a URL that belongs to that
sandbox. That URL is for you to watch the build and click around — it is not a
production address, and it does not survive the sandbox.

This page exists rather than being left out, because "can I deploy from tau" is
the first thing people ask, and the honest answer is more useful than silence.

## What to do instead

The route out is GitHub. Tau pushes your project to a repo you own, and every
host worth using deploys from a repo.

1. Connect GitHub from inside your project.
2. Push — as a new pull request, an update to an existing one, or straight to a
   branch.
3. Point Vercel, Netlify, Fly, Render, Cloudflare Pages or anything else at that
   repo.

From then on your deploys are yours: your account, your domain, your build
settings, your logs.

> [!NOTE]
> Your code is genuinely portable. Tau builds ordinary web projects — there is
> no tau runtime to depend on and nothing to eject from.

## What about the environment?

If tau wired the AI gateway into your app, it set two variables in the sandbox.
Those live on the sandbox, not in your repo — a deploy elsewhere needs them set
on that host too:

```bash
TAU_AI_URL=https://api.usetau.dev/ai
TAU_API_KEY=tau_sk_live_...
```

Copy the key from your billing page. Rotating it there does not update a deploy
you made elsewhere; you will need to paste the new one.

## Will this change?

Deploy support is designed but not built. Until it exists, this page will keep
saying so.
