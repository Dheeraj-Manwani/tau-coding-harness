---
title: Plans and todos
description: Tau writes a todo list before it writes code, and shows it to you as it works through it.
section: build
order: 3
updated: 2026-07-30
---

Before tau writes a line of code on a non-trivial build, it writes a plan: an
ordered todo list, rendered in the chat, ticking over as it goes.

This is not decoration. It is the agent's actual working list, and it is the
cheapest place for you to catch a misunderstanding: a wrong plan costs you one
glance, a wrong build costs you a build.

## What a plan looks like

```text
○ Scaffold the app and install dependencies
○ Define the Habit model and local persistence
○ Build the add-habit form
○ Build the 7-day grid view
○ Style for dark theme and mobile widths
○ Start the dev server and verify it renders
```

As work proceeds, items move to in-progress and then to done. Items can be added
mid-build when tau discovers something the plan missed: a dependency that needs
configuring, a file that needs splitting.

## Read the plan

Look at the plan as soon as it appears, and check two things:

**Is the data model right?** If the plan says "define the Recipe model" and
you meant recipes to belong to collections, say so now.

**Is anything missing that you assumed?** Auth, validation, an empty state, a
mobile layout. If it is not in the plan, it is probably not in the build.

If either is wrong, you have two options: cancel and re-prompt with the missing
detail, or let it finish and send a follow-up. Cancelling is cheaper for a
fundamental mistake; a follow-up is cheaper for an addition.

> [!TIP]
> Cancelling mid-turn stops the job. You are billed for the work already done,
> not for the turns that never ran. See [Iterating](/docs/build/iterating).

## Why plan first

Two reasons, both practical.

The agent works better against a list it wrote than against a paragraph it read.
The plan turns "build a habit tracker" into six bounded tasks, each of which has
an obvious done state.

And it makes the run legible to you. A stream of file writes tells you tau is
busy; a plan tells you what it thinks it is doing and how much is left.

## Plans on small changes

A one-line change does not get a plan, and should not. "Make the button blue" is
one edit and tau will just make it. Plans appear when there is enough work for
sequencing to matter.

## What you cannot do yet

You cannot edit the plan directly: reorder it, delete an item, or rewrite one.
The plan is the agent's, and your influence over it is through the chat: send a
message and the next turn takes it into account.

Plan editing is on the roadmap. Until it exists, this page will keep saying so.

## Next

- [Iterating](/docs/build/iterating): follow-ups, cancel, resume, and being asked
- [Live chat stream](/docs/workspace/chat): how the plan reaches your screen
- [Agent tools](/docs/reference/agent-tools): the tools behind the plan
