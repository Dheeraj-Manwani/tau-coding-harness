---
title: Sub-agents, plans, and asking you
date: 2026-07-01
---

- **A plan before the code.** Tau writes an ordered todo list first and shows it to
  you, ticking items off as it goes. A wrong plan costs you one glance; a wrong
  build costs you a build.
- **Sub-agents.** On higher tiers the agent dispatches read-only specialists with
  their own isolated context: an **explorer** that investigates how part of your app
  works, a **debugger** that reproduces a failure and reports the root cause, and a
  **verifier** that checks changes compile and behave. They report; the main agent
  applies the findings.

  The isolation is the point — a debugger churning through logs does not fill the
  main conversation with them.
- **`ask_user`.** When the agent hits a decision it should not make on your behalf,
  it stops and asks instead of guessing. The job waits, costs nothing while it
  waits, and continues from the same turn when you answer.
- **Web search**, so tau can look things up mid-build.

→ [Plans and todos](/docs/build/plans-and-todos) · [Agent tools](/docs/reference/agent-tools)
