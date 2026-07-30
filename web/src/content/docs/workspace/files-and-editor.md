---
title: Files and the editor
description: A real editor with autosave, what happens when you and the agent touch the same file, and how tau learns about your edits.
section: workspace
order: 3
updated: 2026-07-30
---

The code pane is a real editor — CodeMirror 6, with syntax highlighting and
multiple tabs. You can type in it, and what you type is your project's code.

## Saving

Three things save the file, all of them automatic:

- **⌘S / Ctrl+S** — immediately.
- **Blur** — clicking away from the editor.
- **2 seconds idle** — stop typing and it saves.

A dirty indicator on the tab shows unsaved changes. There is no save button
because there is nothing a save button would add.

A save writes in three places: the live sandbox (so the running preview picks it
up), durable storage, and the project's file manifest. All three go through the
same code path the agent's own file writes use, so a hand-edited file is not a
second-class one.

## Tau is told what you changed

This is the part that matters, and the reason hand-editing is worth doing.

When you save, tau records the change as a hidden message carrying a unified diff
of what you edited. The agent reads it before its next turn.

So the sequence works the way you would want:

1. Tau builds a component.
2. You open it and fix the spacing yourself, because that is faster than
   describing it.
3. You send a follow-up about something else.
4. Tau's next turn knows about your spacing fix and does not undo it.

> [!NOTE]
> Without this, hand-editing would be a trap: your change would look applied and
> then quietly vanish on the next turn. The diff is what makes the two ways of
> editing compatible.

## Editing is blocked while a job runs

You cannot save while the agent is working on the project. You and the agent
writing the same file at the same time has no correct outcome — one of you loses,
silently.

Wait for the job to finish, or cancel it. Then edit.

## Conflicts

Every save carries the hash of the version you started from. If the file has
moved since — usually because the agent rewrote it — the save is refused with a
conflict rather than overwriting.

When that happens: reopen the file, look at the current version, and reapply your
change to it. The refusal is protecting an edit you would otherwise have lost.

## How files are stored

Your project's files live in durable object storage, content-addressed and
deduplicated. The database holds a **manifest** — path, content hash, size — not
the bytes.

Two consequences worth knowing:

- **A dead sandbox does not lose your code.** A new sandbox is rehydrated from
  the manifest. What you lose is the running process, not the files.
- **Re-saving identical content is free.** Same content, same hash, nothing new
  stored.

## What the tree shows

Every file the agent creates or edits, as it lands, plus anything you add. It is
the sandbox's project tree, and it is what a GitHub push publishes — subject to
secret filtering. See [Secrets](/docs/ship/secrets).

## Not on mobile

The file tree and editor are web-only, deliberately. Editing code on a phone
keyboard is not a thing worth building. Everything else about a project works on
mobile. See [Mobile parity](/docs/mobile/parity).

## Next

- [Preview](/docs/workspace/preview)
- [Secrets](/docs/ship/secrets)
- [Errors](/docs/reference/errors) — including what a 409 conflict means
