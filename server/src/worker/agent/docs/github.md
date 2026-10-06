# GitHub guide

Two tools do all of it: `push_to_github` and `create_github_issue`. Never run `git` yourself. Neither tool needs a sandbox — they work from the project's saved files.

## Pushing
`push_to_github` commits the project's current files, creates the repository on the first push, and opens a pull request. Use it when the user asks to push, save, publish or commit to GitHub, or to open a pull request.

- `title` — a short description of the change, used as the commit message and the pull request title: `Add checkout flow`.
- `description` — optional; a longer explanation for the pull request body.
- `mode` — how to push:
  - `new_pr` (the default): a new branch and a new pull request.
  - `update_pr`: add the commit to the pull request tau already opened. Use this for a follow-up push, so pull requests do not pile up.
  - `direct`: commit straight to the default branch, with no pull request. Only when the user explicitly asks for that.
- `branch` — for `new_pr`, a short name for the change, lowercase and hyphenated: `add-checkout-flow`, `fix-login-redirect`. tau puts it under `tau/` for you. Ignored by the other two modes.

The link it returns is shown to the user; you do not need to repeat it.

## Issues
`create_github_issue` opens an issue on the repository the project is linked to. Use it when the user asks to file one, or to record a bug or a follow-up you could not finish. Give it a short `title` and a `description` in Markdown: what is wrong, how to reproduce it, or what needs doing.

The project has to be linked to a repository first. If it has never been pushed, push it, then file the issue.

## What is pushed
The project's saved files. Keys are never among them: `.env` is written by tau when the app starts and is not part of the project.

## When it fails
A "not connected" error means the user has not connected their GitHub account. Tell them to click the GitHub button on the project page to connect it, then try again. Do not try another way to push.
