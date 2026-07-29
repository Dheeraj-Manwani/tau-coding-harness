---
title: Effort tiers
description: Which model runs, how long it may think, and what a single build can cost.
section: build
order: 2
updated: 2026-07-30
---

Effort is the single control that decides how hard tau works on a build. It sets
four things at once: which model runs, how many turns the agent gets, how wide
it can fan out into sub-agents, and the ceiling on what one build may spend.

Every tier is available on every plan. You are not buying access to Max — you
are paying for the work it does.

## The tiers

| | **Low** | **High** | **Max** |
|---|---|---|---|
| Model | DeepSeek (flash) | DeepSeek (pro) | Kimi K2.7 Code |
| Agent turns | 80 | 200 | 300 |
| Sub-agent turns | 20 | 40 | 60 |
| Parallel sub-agents | 1 | 3 | 5 |
| Wall clock | 20 min | 45 min | 90 min |
| Spend cap per build | 15 credits | 50 credits | 100 credits |

## Choosing one

- **Low** — tweaks, a single page, copy changes. Fast and cheap.
- **High** — most real apps. This is the sensible default.
- **Max** — big multi-file builds, and anything you have already tried once and
  want done properly.

> [!TIP]
> Effort is per message, not per project. Start a build on High, then send the
> follow-up that fixes the hard bit on Max.

## What the caps mean

**Wall clock** is a backstop, not a target. Agent turns bound a loop that is
making progress; they cannot stop one wedged inside a single turn — a model
stream that stalls, or a command that never returns. The wall clock can.

**Spend cap** is the most a single build may consume before tau stops and tells
you. It is a ceiling, not a price: a small build on Max costs what it costs, not
100 credits.

> [!WARNING]
> Running out mid-build stops the job cleanly — nothing is lost — but it does
> stop it. If you are starting something large, check your balance first.
