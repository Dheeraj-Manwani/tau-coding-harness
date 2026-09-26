---
title: Edit the code yourself
date: 2026-07-19
---

The code pane is now a real editor, not a viewer.

- **Type in it.** CodeMirror 6, with multiple tabs and a dirty indicator.
- **Autosave** on `⌘S`, on blur, and after 2 seconds idle. A save writes the live
  sandbox, durable storage, and your project's manifest — the same path the
  agent's own writes use.
- **Tau is told what you changed.** Your edit is recorded as a diff the agent reads
  before its next turn, so a hand-edit survives instead of being quietly
  overwritten. This is the part that makes editing by hand worth doing.
- **Conflicts are refused, not merged.** A save carries the hash of the version you
  started from; if the agent has since rewritten the file, the save is refused
  rather than clobbering it.

Editing is blocked while a job is running, because you and the agent writing the
same file at the same time has no correct outcome.

→ [Files and the editor](/docs/workspace/files-and-editor)
