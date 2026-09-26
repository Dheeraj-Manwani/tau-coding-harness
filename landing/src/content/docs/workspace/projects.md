---
title: Projects
description: The project list, screenshots as thumbnails, deleting, and the free-plan three-project cap.
section: workspace
order: 5
updated: 2026-07-30
---

A project is one app: its chat history, its files, its sandbox, and optionally a
linked GitHub repo.

## Creating one

Send a prompt. That is it: there is no project form. The first message creates
the project, provisions the sandbox and starts the first job in one step.

## The list

Each project is a card with its name and a screenshot of the finished preview.
The screenshot is captured automatically when a build completes, which is what
makes a list of six projects readable rather than six identical rectangles.

## The free-plan cap

Free accounts can hold **3 projects** at a time. PRO is unlimited.

The cap is on projects you *have*, not projects you have ever made. Delete one and
the slot frees up immediately.

If you hit it, you will get a clear refusal rather than a half-created project.

> [!TIP]
> Three is enough to keep one real thing, one experiment, and one you have not
> got round to deleting. If you are bumping the cap regularly, that is what PRO
> is for. See [Plans](/docs/billing/plans).

## Deleting

Deleting a project removes its files, its chat history and its manifest. This is
not reversible and there is no restore.

Before deleting anything you might want later: push it to GitHub. That is your
only archive, and it is a good one: an ordinary repo you own.

> [!WARNING]
> There are no checkpoints and no undo. A deleted project is gone, and a project
> you have not pushed exists only inside tau.

## Concurrency

One job runs at a time per account by default. Starting a second build while one
is running is refused with a clear message rather than queued indefinitely.

This is deliberate: a build has a real sandbox and a real spend cap behind it, and
letting a single account run several at once is how you empty a balance by
accident.

There is also a **cancel all** if you want to stop everything.

## What a project does not have

- **Checkpoints or restore.** Push to GitHub at points you might want back.
- **A shareable link.** Preview URLs are temporary and belong to a sandbox; they
  are not a way to publish.
- **Reverse sync from GitHub.** Commits you make in your repo do not come back
  into the tau project. Treat the push as an export.

## Next

- [Preview](/docs/workspace/preview)
- [GitHub](/docs/ship/github)
- [Plans](/docs/billing/plans)
