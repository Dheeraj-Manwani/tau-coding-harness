---
title: GitHub
description: Connect once, then push from inside a project: as a new PR, an update to one, or straight to a branch.
section: ship
order: 1
updated: 2026-07-30
---

GitHub is how code leaves tau. Connect once per account, then push from any
project.

## Connecting

Authorise tau from your account settings or from a project's GitHub panel. It is
a normal OAuth flow, once, and it applies to every project.

Disconnecting revokes tau's access. Repos you already pushed are unaffected -
they are yours.

## Linking a repo

Per project, either pick an existing repo or have tau create one. The link is
stored on the project, so subsequent pushes need no setup.

You can unlink and relink to a different repo at any time.

## Push modes

Three, chosen at push time:

| Mode | What it does | When |
|---|---|---|
| **New pull request** | Creates a branch, commits to it, opens a PR | The default. Review before merging. |
| **Update pull request** | Commits to the branch of the PR you already opened | Iterating on work already under review |
| **Push direct** | Commits straight to a branch | Your own project, no review needed |

## How the commit is made

Tau builds commits through GitHub's Git Data API: it constructs the tree and the
commit objects and posts them.

There is no `git` binary in the sandbox and no clone. Practically, that means a
push is a single API interaction rather than a shell session that can leave the
sandbox in a half-committed state.

## Secrets are filtered first

Before anything is published, the tree builder removes secret-looking paths as a
**hard floor**, and only then applies your project's own `.gitignore`.

The order is the point: deleting your `.gitignore` still cannot publish a key.

→ [Secrets](/docs/ship/secrets)

## Opening issues

Tau can open a GitHub issue on your linked repo, on request. Useful for the thing
it noticed but did not fix: a rough edge, a follow-up, a TODO worth tracking
outside the chat.

## What does not happen

**No reverse sync.** Commits you make in your repo do not flow back into the tau
project. Tau does not read your repo's tree; the link is one-directional.

Treat a push as an export. If you edit in your repo and then keep building in
tau, the two diverge and tau's copy is the one it will keep editing.

> [!WARNING]
> Do not develop in both places at once. Pick tau or your repo as the working
> copy for a given stretch of work.

## Next

- [Secrets](/docs/ship/secrets)
- [Exporting](/docs/ship/exporting)
- [Deploying](/docs/ship/deploying)
