---
title: What is tau
description: Tau turns a sentence into a real, running web app — planned, coded, and previewed live in a cloud sandbox.
section: start
order: 1
updated: 2026-07-30
---

Tau turns a sentence into a running web app. You describe what you want; tau
plans it, writes it, runs it in a secure cloud sandbox, and streams every step
to your screen — the plan, the files, the code, and a live preview you can click.

## What actually happens

When you send a prompt, tau starts a **job**. That job runs an agent inside a
Linux sandbox provisioned for your project. The agent has real tools: it reads
and writes files, runs shell commands, installs packages, searches the web, and
starts your dev server.

Everything it does streams back to you as it happens. Reload the page mid-build
and the stream picks up where it left off.

> [!NOTE]
> The sandbox is a real machine, not a preview renderer. When you see your app
> running, it is genuinely serving from a port inside that sandbox.

## What you get

- **A plan before the code.** Tau writes a todo list first and shows it to you,
  ticking items off as it goes.
- **The whole workspace.** Chat, the file tree, a real editor, and the live
  preview — not just a finished artefact.
- **Your code.** Connect GitHub and push it to a repo you own, any time.

## What tau does not do yet

Tau does not deploy your app to a domain of your own. It builds and runs it in
the sandbox; publishing is your call, from your own GitHub repo.

## Where to go next

Pick an effort tier that matches the job — see [Effort tiers](/docs/build/effort-tiers) —
and read [Deploying](/docs/ship/deploying) before you plan a launch.
