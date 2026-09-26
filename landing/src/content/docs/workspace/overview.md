---
title: Workspace overview
description: The four panels of a tau project, and why you get the whole machine rather than just the output.
section: workspace
order: 1
updated: 2026-07-30
---

Open a project and you get four panels. Together they are the machine, not a
report about it.

```text
┌───────────────┬──────────────────┬─────────────────┐
│  chat         │  file tree +     │   preview       │
│               │  code editor     │                 │
└───────────────┴──────────────────┴─────────────────┘
```

## Chat

The conversation, and the live event stream. Tokens, tool calls, file writes and
the todo list all arrive here as they happen. This is where you send follow-ups,
cancel a job, and answer a question the agent asks.

→ [Live chat stream](/docs/workspace/chat)

## File tree

Every file in your project, as it lands. Not a summary: the actual tree from the
sandbox, which is also what gets pushed to GitHub.

## Code editor

A real editor (CodeMirror 6), not a viewer. Type in it. It autosaves to the
sandbox and to storage, and tau is told what you changed so your edit survives
its next turn.

→ [Files and the editor](/docs/workspace/files-and-editor)

## Preview

Your app, running on a live URL inside the sandbox, in an iframe you can click.
When the dev server answers on its port, this fills in.

→ [Preview](/docs/workspace/preview)

## Why all four

An agent that hands you a finished artefact is asking you to trust it. Most of
the time that trust is misplaced in small ways: a file you would have named
differently, a dependency you did not want, a component that works but not the
way you meant.

Showing the whole workspace changes what you can do about it. You can see which
file the mistake is in, open it, fix it yourself if that is quicker, or describe
it precisely enough that tau fixes it in one turn instead of three.

> [!NOTE]
> The mobile app has chat, preview and everything around a build, but
> deliberately not the file tree or the editor: those want a keyboard. See
> [Mobile parity](/docs/mobile/parity).

## Projects

Above the workspace sits the project list: one card per app, with a screenshot of
the finished preview as its thumbnail.

→ [Projects](/docs/workspace/projects)

## Next

- [Live chat stream](/docs/workspace/chat)
- [Files and the editor](/docs/workspace/files-and-editor)
- [Preview](/docs/workspace/preview)
