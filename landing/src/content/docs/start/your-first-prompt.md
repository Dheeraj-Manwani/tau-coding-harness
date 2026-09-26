---
title: Your first prompt
description: A worked example — one sentence in, a running app out, and the two follow-ups that finish it.
section: start
order: 4
updated: 2026-07-30
---

This page follows one build the whole way through, so you know what the screen
is going to do before it does it.

## The prompt

```text
A habit tracker. I add habits, tick them off each day, and see a
7-day grid of what I hit. Dark theme, works on a phone.
```

Sent on **High**.

Four things make this a good first prompt, and none of them are technical:

- **A noun** — "a habit tracker". Tau needs to know what it is building.
- **The data** — habits, and a tick per day. This becomes the schema.
- **One view** — the 7-day grid. Naming the screen you care about stops tau
  guessing.
- **A constraint** — dark, mobile. Two words that replace a design review.

## What happens, in order

**A plan appears first.** Before any file exists, tau writes a todo list and
shows it to you. Something like: scaffold the app, define the habit model, build
the add-habit form, build the grid, wire persistence, style it, verify it runs.
Items tick over as they complete.

**Then the sandbox.** A Linux machine is provisioned for the project. You will
see commands run in it — a package install, a dev server starting.

**Then files.** They appear in the tree in the order tau writes them, and the
code pane shows what went in. This is the real file tree, not a summary; you can
open anything.

**Then a preview.** When the dev server answers on its port, the preview pane
loads your app on a live URL. It is running, and you can click it.

On High this whole sequence is typically a few minutes.

> [!TIP]
> You do not have to watch. Close the tab, come back later, and the stream
> resumes from where it was — nothing is lost by leaving.

## The first follow-up

The grid works but the days are unlabelled. So:

```text
Label the grid columns with weekday initials, and highlight today's column.
```

Same chat, same project, same sandbox. Tau reads the file it already wrote,
edits it, and the preview reloads. This is much cheaper than the first message —
it is one small change, so send it on **Low**.

## The second follow-up

```text
Ticks vanish when I reload. Persist them in localStorage.
```

Naming the symptom ("ticks vanish when I reload") is better than naming the fix.
Tau can usually find a cause you have described more reliably than it can guess
what you meant by a solution.

## What you would do next

- **Edit it yourself.** Open the grid component in the editor and change the
  colours by hand. Tau is told what you changed, so its next turn builds on your
  edit rather than overwriting it.
- **Push it.** Connect GitHub, push to a repo you own, deploy from there.
- **Keep going.** Follow-ups are unlimited; the project is yours to grow.

## What to avoid on a first prompt

- **A whole product spec.** Six screens in one message gets you six shallow
  screens. Build one, then extend it.
- **Naming a stack you do not need.** "Use Next.js with tRPC and Prisma" narrows
  tau to a shape it now has to satisfy, often for no gain.
- **Being vague about the data.** "A tracker for stuff" has no schema in it, so
  tau invents one, and it will not be yours.

More on all three in [Writing prompts](/docs/build/writing-prompts).

## Next

- [Writing prompts](/docs/build/writing-prompts)
- [Iterating](/docs/build/iterating) — follow-ups, cancel, resume
- [What tau can build](/docs/build/what-tau-can-build) — and what it can't
