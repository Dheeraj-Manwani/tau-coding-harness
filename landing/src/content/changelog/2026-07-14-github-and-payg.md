---
title: Push to GitHub, and pay for what you use
date: 2026-07-14
---

Two changes, both about ownership.

## GitHub

- **Connect once**, then push from inside any project.
- **Three push modes**: open a new pull request, update an existing one, or commit
  straight to a branch.
- **Commits are built through GitHub's Git Data API.** No `git` binary in the
  sandbox and no clone, so a push is one interaction rather than a shell session
  that can leave things half-committed.
- **Open a GitHub issue** from the agent, for the thing it noticed but did not fix.

This is how code leaves tau, and it is the answer to "do I own this".

## Pay as you go

- **Every effort tier is open on every plan**, including Max. Nothing is behind the
  paywall: the plans differ in credits and project slots, not features.
- **Credits are metered per token** against the model that actually ran.
- **The free grant is 20 credits**, once, at signup.
- **A per-build spend ceiling by tier**: 15, 50 or 100 credits: so a single build
  cannot surprise you.

→ [GitHub](/docs/ship/github) · [Credits](/docs/billing/credits)
