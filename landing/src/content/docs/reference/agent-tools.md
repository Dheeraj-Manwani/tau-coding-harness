---
title: Agent tools
description: Every tool the agent can call, and what each one lets tau do.
section: reference
order: 1
updated: 2026-07-30
---

The agent is a model with tools. When you see a tool line in the chat, this is
what it was.

Which tools are available depends on the [effort tier](/docs/build/effort-tiers) -
sub-agent dispatch in particular is only useful where the budget allows parallel
work.

## Planning

| Tool | What it does |
|---|---|
| `create_plan` | Writes the initial todo list, before any code |
| `add_todos` | Adds items discovered mid-build |
| `update_todo` | Moves an item's status as work proceeds |
| `report_progress` | Narrates what it is doing between steps |

→ [Plans and todos](/docs/build/plans-and-todos)

## Files

| Tool | What it does |
|---|---|
| `create_file` | Writes a new file |
| `read_file` | Reads a file in the sandbox |
| `edit_file` | Edits part of an existing file |
| `delete_file` | Deletes a file |
| `list_dir` | Lists a directory |

Every write goes through the same path your own editor saves use, and lands in
your project's stored manifest: except for
[secret-shaped paths](/docs/ship/secrets), which are written to the sandbox but
never persisted.

## Commands and the sandbox

| Tool | What it does |
|---|---|
| `run_command` | Runs a shell command: installs, builds, starting the dev server |
| `tail_command_output` | Reads more output from a long-running command |
| `wait_for_port` | Waits for the dev server to answer, which is what makes the preview appear |
| `provision_sandbox` | Brings up a sandbox for the project |
| `check_sandbox` | Verifies the environment is healthy |

## Research and assets

| Tool | What it does |
|---|---|
| `web_search` | Looks things up while building |
| `search_images` | Finds real images for your app |
| `download_asset` | Fetches an image or file into the project |
| `image_dimensions` | Reads an image's size, so layout can be right first time |

Together these are why a tau-built page can have real photographs in it rather
than grey placeholder boxes.

## AI and shipping

| Tool | What it does |
|---|---|
| `enable_ai` | Wires the [AI gateway](/docs/ai/overview) into your app: mints the key, injects the env vars, declares them in `.tau/deploy.json` |
| `push_to_github` | Pushes your project: new PR, update PR, or direct |
| `create_github_issue` | Opens an issue on your linked repo |

→ [AI quickstart](/docs/ai/quickstart) · [GitHub](/docs/ship/github)

## Asking you

| Tool | What it does |
|---|---|
| `ask_user` | Stops and asks, instead of guessing |

The job pauses and waits for your reply in the chat. It costs nothing while it
waits, and the agent keeps its context: answering continues the same turn.

→ [Iterating](/docs/build/iterating)

## Sub-agents

On higher tiers, the agent can dispatch specialists with their own isolated
context. All three are **read-only**: they investigate and report, and the main
agent applies the findings.

| Tool | What it does |
|---|---|
| `dispatch_explorer` | Investigates how part of the existing app works and explains it. Used for orienting in an unfamiliar area rather than opening twenty files by hand |
| `dispatch_debugger` | Reproduces a bug, reads logs and files, runs commands, and reports the root cause with a recommended fix |
| `dispatch_verifier` | Checks that things compile, hits changed API routes, spot-checks behaviour, and returns a pass/fail report |

The isolation is the point: a debugger churning through logs does not fill the
main conversation's context with them, so the main agent stays focused on the
build.

Parallel sub-agents by tier: **1** on Low, **3** on High, **5** on Max.

## What the agent cannot do

- **Deploy your app.** See [Deploying](/docs/ship/deploying).
- **Read your GitHub repo.** Pushing is one-directional.
- **Persist a secret-shaped file.** See [Secrets](/docs/ship/secrets).
- **Obtain a third-party credential on your behalf.**
- **Edit the plan structurally**: no removing or relabelling a todo. On the
  roadmap.

## Next

- [Limits](/docs/reference/limits)
- [Errors](/docs/reference/errors)
- [Glossary](/docs/reference/glossary)
