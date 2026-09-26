---
title: Core concepts
description: Projects, jobs, sandboxes, messages and credits: the five words the rest of these docs assume.
section: start
order: 3
updated: 2026-07-30
---

Five words carry most of tau's behaviour. Once these are clear, the rest of the
documentation reads as detail.

## Project

A project is one app. It owns a chat history, a file tree, a sandbox, and
optionally a linked GitHub repo.

Projects are created by your first prompt: there is no "new project" form to
fill in. Free-plan accounts can hold **3** projects at a time; PRO is
unlimited. Deleting a project removes its files and its history.

## Job

A job is one run of the agent. Every message you send starts a job; so does
pressing **Start preview**.

A job has a status, a turn count, and a spend ceiling set by its effort tier. It
ends for one of several reasons: finished, cancelled, out of credits, out of
turns, out of wall clock: and the workspace tells you which.

> [!NOTE]
> Effort is chosen per job, not per project. A project can have a Low job, then a
> Max job, then a Low one again.

## Sandbox

A sandbox is a real Linux machine, provisioned per project. It has Node, a
package manager, a shell, and a port that can serve your app to a URL.

The agent works *inside* it: reads and writes files there, runs commands there,
starts your dev server there. The preview you click is that server.

Sandboxes are not permanent. Your files are: they are stored separately, and a
new sandbox is rehydrated from them. What a dead sandbox costs you is the
running process, not your code.

## Message

A message is one entry in the project chat. Yours carry your prompt and any
attachments; tau's carry its reasoning, its tool calls, and its results.

Some messages are not shown as bubbles: when you edit a file by hand, tau
records a hidden message carrying the diff, so the agent knows what changed
before its next turn.

## Credit

A credit is the unit of work. Everything tau does for you: every model call on
a build, and every call your generated app makes through the
[AI gateway](/docs/ai/overview): is metered in credits.

Two kinds of spend are tracked separately:

| | What it is |
|---|---|
| **Build spend** | The agent working on your project |
| **Runtime spend** | Your finished app calling the AI gateway |

You see them split apart on your billing page. See
[Credits](/docs/billing/credits).

## How they fit together

```text
project
 ├── sandbox            one Linux machine, rebuildable
 ├── files              stored durably, independent of the sandbox
 ├── messages           the chat, yours and tau's
 └── jobs               one per message; each metered in credits
```

## Next

- [Your first prompt](/docs/start/your-first-prompt)
- [The workspace](/docs/workspace/overview)
- [Every limit in one table](/docs/billing/limits)
