---
title: Iterating
description: Follow-ups, cancelling mid-turn, resuming after a reload, and what happens when tau asks you a question.
section: build
order: 4
updated: 2026-07-30
---

A build is a conversation, not a submission. Everything below is how you steer
one after the first message.

## Follow-ups

Send another message in the same chat. Tau picks up the same project: same
files, same sandbox: and works from there.

```text
The header overlaps the content on mobile. Fix the spacing.
```

Follow-ups are usually much cheaper than the first build: the app already
exists, so tau is reading a few files and editing one, not scaffolding a project.

Effort is chosen **per message**. Build the hard part on High or Max, then send
the polish on Low.

> [!TIP]
> One change per message is easier to review and cheaper to redo than five. If a
> follow-up goes wrong, you want to know which change caused it.

## Cancel

Hit cancel and the job stops mid-turn. There is also a cancel-all, for when
you have started something across several projects and want everything to stop.

You are charged for the work that actually happened: the turns that ran, the
tokens they used. You are not charged for the turns that never ran.

Cancel when:

- The plan is wrong in a way a follow-up cannot fix.
- Tau is heading somewhere you did not intend and has some way to go.
- You realise your prompt was missing something fundamental.

Do not cancel just because it is taking a while. A build on High has 45 minutes
of wall clock for a reason, and most of the useful work is in the later turns.

## Reload and resume

Close the tab. Come back an hour later. Open the project.

The stream resumes where it was: the chat rebuilds, the file tree is current,
and if the job is still running you start receiving live events again from the
right point. The build does not depend on your browser being open.

This works because every event in a run is sequenced, and reconnecting asks for
everything after the last index you received.

## When tau asks you a question

If the agent hits a decision it should not make on your behalf, it stops and
asks. The question appears in the chat and the job waits for your answer.

Typical questions are the ones you would want to be asked: which of two
interpretations you meant, whether it is safe to replace something you might
care about, which of several plausible defaults you want.

Answer in the chat and the job continues from the same turn. It has not lost its
context and is not starting again.

> [!NOTE]
> A question costs you nothing while it waits. It is not consuming turns or
> credits sitting there.

## How a job ends

A run stops for one of these reasons, and the workspace tells you which:

| Reason | What it means | What to do |
|---|---|---|
| Finished | Tau considers the work done | Look at it; send a follow-up |
| Cancelled | You stopped it | Re-prompt with what was missing |
| Out of turns | Hit its tier's agent-turn budget | Send a follow-up, or use a higher tier |
| Out of wall clock | Hit its tier's time limit | Usually means something wedged; retry |
| Out of credits | Hit the spend cap or your balance | Top up, then continue |
| Failed | Something broke | See [Troubleshooting](/docs/help/troubleshooting) |

None of these lose your files. Whatever was written is on disk and in storage,
and a follow-up continues from there.

## Editing by hand mid-conversation

You can open the editor and change code yourself between jobs. Tau is told what
you changed: it receives the diff before its next turn: so your edit is not
quietly overwritten.

Editing is blocked while a job is running, because you and the agent writing the
same file at the same time has no good outcome. See
[Files and the editor](/docs/workspace/files-and-editor).

## A restart can drop an in-flight build

If tau's own service restarts while your job is running, that job is lost. The
row is cleaned up so nothing about your project is left broken, but the work is
gone and you need to resubmit.

You are not charged for work that did not happen. This is a known limitation of
the current architecture, not a transient bug.

## Next

- [Writing prompts](/docs/build/writing-prompts)
- [Files and the editor](/docs/workspace/files-and-editor)
- [Errors](/docs/reference/errors)
