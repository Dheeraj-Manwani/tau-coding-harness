---
title: Preview
description: Your app running on a live URL: the sandbox lifecycle, Start preview, and why a URL can stop working.
section: workspace
order: 4
updated: 2026-07-30
---

The preview pane is your app, actually running. A dev server inside your
project's sandbox is serving a port, and the pane is an iframe pointed at it.

It is not a rendering of your code. It is your code, executing.

## How it appears

During a build, tau starts your dev server and waits for it to answer on its
port. When it does, the preview loads. If the server fails to start, tau sees
that too: and usually fixes it, since a non-booting app is a failure it can read
the error from.

## Sandboxes are not permanent

A sandbox is a real Linux machine provisioned for your project, and it does not
live forever. Idle ones go away.

When that happens the preview URL stops working. Your **code is unaffected** -
files are stored durably and independently of any sandbox.

## Start preview

The **Start preview** button rebuilds a running environment without running the
agent:

1. Reconnect to your sandbox if it is still alive, or provision a new one.
2. Rehydrate it from your stored files.
3. Install and start the dev server.
4. Hand back a fresh URL.

This is a job like any other, so you will see it in the chat: but it is not an
agent run. It is much cheaper: no model is thinking, it is just bringing a
machine up.

> [!TIP]
> A dead preview is the normal case for a project you have not opened in a while.
> Press **Start preview** rather than re-prompting: re-prompting spends credits
> on an agent you did not need.

## Why a URL stops working

| Cause | Fix |
|---|---|
| The sandbox was idle and went away | **Start preview** |
| The dev server crashed | **Start preview**, or tell tau what the error says |
| The app compiles but the page is blank | A follow-up: describe what you see |
| The port changed | **Start preview** |

## Sharing a preview URL

Don't, for anything that matters. A sandbox URL is temporary by nature: it will
stop working, possibly within the hour, and it is not a production address.

To share something durable, push to GitHub and deploy it. See
[Deploying](/docs/ship/deploying).

## Screenshots

When a build finishes, tau captures a screenshot of the running preview and uses
it as the project's card thumbnail. That is what makes the project list
recognisable at a glance.

## Known gap

The sandbox lifecycle is not fully modelled: some intermediate states exist in
the schema and are never written, and sandboxes can leak rather than being
reclaimed on a schedule. This is a tau-side operational issue, not something you
need to manage: the user-visible symptom is only ever a preview URL that needs
**Start preview**.

## Next

- [Files and the editor](/docs/workspace/files-and-editor)
- [Projects](/docs/workspace/projects)
- [Troubleshooting](/docs/help/troubleshooting)
