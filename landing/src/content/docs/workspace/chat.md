---
title: Live chat stream
description: What streams into the chat while tau works, and why reloading mid-build never loses your place.
section: workspace
order: 2
updated: 2026-07-30
---

The chat is both the conversation and the live telemetry of a running build.

## What arrives, and in what form

**Your messages**: your prompt, plus any attachments as chips.

**Assistant text**: streamed token by token as the model produces it.

**Tool calls**: a compact line per action: a file read, a file write, a command
run, a web search. You can see what the agent actually did, not a paraphrase of
it.

**The todo list**: rendered as a checklist that updates in place as items tick
over. See [Plans and todos](/docs/build/plans-and-todos).

**Questions**: when the agent stops to ask you something, it appears here and
the job waits for your reply.

**A finish reason**: every job ends with one, and the chat says which. Finished,
cancelled, out of turns, out of credits, out of time, or failed.

## Reload-safe by construction

Every event in a run carries a sequence index. When your browser connects, it
asks for everything after the last index it has.

The practical consequences:

- **Reload mid-build** and the chat rebuilds, then live events resume from the
  right point. Nothing is duplicated and nothing is skipped.
- **Close the tab** and the build carries on without you.
- **Open the project on another device** and you see the same run.

> [!NOTE]
> The stream is a view of the job, not the job itself. Your browser being
> connected is not what keeps the build alive.

## Streaming transport

The web app receives events over Server-Sent Events; the mobile app does the same
thing over its own SSE client. Cancel is a plain request, not a stream message -
so cancelling works even if your stream has dropped.

## Reading a build in progress

Two habits make the stream useful rather than noisy:

**Watch the plan, not the tokens.** The todo list tells you where you are. The
token stream tells you tau is busy, which you already knew.

**Watch which files it touches.** If it is editing a file you did not expect, or
rewriting one you edited by hand, that is worth catching early: a follow-up now
is cheaper than a fix later.

## Message history

The full history is stored per project and loads when you open it. Some entries
are not shown as bubbles: when you edit a file yourself, tau records a hidden
message carrying the diff so the agent knows what changed. You see the effect of
it: the agent respecting your edit: rather than the record itself.

## Next

- [Files and the editor](/docs/workspace/files-and-editor)
- [Iterating](/docs/build/iterating): cancel, resume, being asked
- [Preview](/docs/workspace/preview)
