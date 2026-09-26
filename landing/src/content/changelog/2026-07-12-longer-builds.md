---
title: Longer builds stay coherent
date: 2026-07-12
---

A long build used to run out of room in its conversation and start losing the
thread. Tau now manages that budget itself.

- **Compaction** trims old tool output — the twelfth `npm install` log is not worth
  the space it occupies.
- **Summarisation** condenses earlier turns once the conversation gets long, keeping
  the shape of what happened rather than the exact text.

You should not notice either. The visible effect is that a Max build with 300 turns
available can actually use them.

> [!TIP]
> On a very long build, if tau starts forgetting a constraint you set at the
> beginning, restate it in a follow-up. That is cheaper than fighting it.

→ [Limits](/docs/billing/limits)
