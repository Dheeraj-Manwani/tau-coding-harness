---
title: Exporting your code
description: The one route out today is GitHub. There is no ZIP download: here is what to do.
section: ship
order: 3
updated: 2026-07-30
---

Your code is yours. Today there is exactly one way to take it: push it to a
GitHub repo you own.

## GitHub is the route out

Connect GitHub, link or create a repo, push. The commit lands in your repo under
your account, and from that point on it is an ordinary project with no
relationship to tau.

Full detail in [GitHub](/docs/ship/github).

## There is no ZIP download

Not built. If you want your code out of tau, GitHub is the way.

It is on the roadmap, and this page will change when it exists. Until then it is
better to say so plainly than to leave you looking for a button.

> [!NOTE]
> A private GitHub repo is free and works as an archive. Push, then clone locally
> if you want the files on disk.

## What you get when you push

An ordinary web project: source files, a `package.json`, a lockfile, config. There
is no tau runtime, no proprietary wrapper, and nothing to eject from. It builds
and runs the same way anywhere.

## What does not come with it

**Secret-shaped files.** Anything credential-shaped was never stored, so it is not
in the repo. If your app needs a `.env`, recreate it. See
[Secrets](/docs/ship/secrets).

**The AI gateway variables.** If tau wired AI into your app, it set `TAU_AI_URL`
and `TAU_API_KEY` in the sandbox. Those are environment variables, not files in
your repo: set them on whatever host you deploy to. See
[API keys](/docs/ai/api-keys).

**Your chat history.** The conversation stays in tau. The code is what is exported.

**Anything ignored by your `.gitignore`.** Build output, `node_modules`, on-disk
data directories.

## Before you delete a project

Push it first. Deleting a project is not reversible and there are no
checkpoints: a project you have not pushed exists only inside tau.

> [!WARNING]
> This is the one irreversible action in tau. Push, then delete.

## Next

- [GitHub](/docs/ship/github)
- [Deploying](/docs/ship/deploying)
- [Projects](/docs/workspace/projects)
