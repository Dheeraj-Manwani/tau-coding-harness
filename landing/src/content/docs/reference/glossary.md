---
title: Glossary
description: Every term these docs use, defined once.
section: reference
order: 4
updated: 2026-07-30
---

## Agent

The model plus its tools, running your build inside a sandbox. What you watch in
the chat is the agent working. → [Agent tools](/docs/reference/agent-tools)

## Alias (model alias)

The name your app asks the AI gateway for: `tau-fast`, `tau-smart`, `tau-max` -
rather than a vendor model id. The indirection means tau can change provider
without breaking deployed apps. → [AI overview](/docs/ai/overview)

## Attachment

A file on a message: an image, a PDF, a text file, or pasted content. Tau extracts
text from it before the agent reads it. → [Attachments](/docs/build/attachments)

## Bonus credits

The bucket holding credit-pack purchases and redeemed promo codes. Never expires,
spent last. → [Credits](/docs/billing/credits)

## Build spend

Credits consumed by the agent working on your project. Shown separately from
runtime spend.

## Cancel

Stopping a running job mid-turn. You pay for the work done, not the budget.
→ [Iterating](/docs/build/iterating)

## Credit

The unit of work. Everything tau does: every model call on a build, every gateway
call from your app: is metered in credits. → [Credits](/docs/billing/credits)

## Daily cap

A per-day spend ceiling on your API key, resetting at 00:00 UTC. Defaults to 20
credits. The backstop against a public endpoint draining your balance.
→ [API keys](/docs/ai/api-keys)

## Effort

The tier chosen per message: Low, High or Max: setting which model runs, how
many turns the agent gets, how wide it can fan out, and the spend ceiling for that
build. → [Effort tiers](/docs/build/effort-tiers)

## Finish reason

Why a job ended: finished, cancelled, out of turns, out of wall clock, out of
credits, or failed. Distinct from whether it succeeded.
→ [Errors](/docs/reference/errors)

## Free credits

The bucket holding the one-time 300-credit signup grant. Never expires, spent
first.

## Gateway

Tau's AI service (`/ai` and `/v1`) that generated apps call to reach a model,
billed to your credits. → [AI overview](/docs/ai/overview)

## Job

One run of the agent. Every message you send starts one; so does **Start
preview**. Has a status, a turn count, and a spend ceiling.
→ [Core concepts](/docs/start/core-concepts)

## Manifest

Your project's file list: path, content hash, size: stored in tau's database.
The bytes themselves live in object storage. It is the manifest a GitHub push
publishes. → [Files and the editor](/docs/workspace/files-and-editor)

## Plan (the todo list)

The ordered list tau writes before it writes code, shown in the chat and ticked
off as it goes. → [Plans and todos](/docs/build/plans-and-todos)

## Plan (the subscription)

Free or PRO. → [Plans](/docs/billing/plans)

## Plan credits

The bucket holding your PRO monthly allotment. Expires at the end of the billing
cycle, spent before bonus credits.

## Preview

Your app running on a live URL inside the sandbox, in an iframe you can click. Not
a rendering: the actual dev server. → [Preview](/docs/workspace/preview)

## Project

One app: its chat history, files, sandbox, and optionally a linked GitHub repo.
Created by your first prompt. → [Projects](/docs/workspace/projects)

## Promo code

A redeemable code granting credits into the bonus bucket.
→ [Promo codes](/docs/billing/promo-codes)

## Re-auth

Confirming who you are a second time, while already signed in, for a sensitive
action: revealing or rotating your API key.
→ [API keys](/docs/ai/api-keys)

## Rotation grace window

The 24 hours a replaced API key keeps working, so deployed apps can be updated
before the old key dies. → [API keys](/docs/ai/api-keys)

## Runtime spend

Credits consumed by your finished app calling the AI gateway: its traffic, your
credits. Shown separately from build spend.
→ [Gateway billing](/docs/ai/billing)

## Sandbox

The Linux machine provisioned per project, where the agent works and your app
runs. Not permanent; your files are stored independently of it.
→ [Preview](/docs/workspace/preview)

## Secret path

A credential-shaped file path that is never persisted to your project's manifest,
and therefore never pushed. Applied before your `.gitignore`, as a hard floor.
→ [Secrets](/docs/ship/secrets)

## Spend cap

The most one build may consume, set by its effort tier: 5,000, 25,000 or 50,000 credits. A
ceiling, not a price.

## Spend split

The build-versus-runtime breakdown on your billing page.

## Sub-agent

A read-only specialist the agent dispatches with its own isolated context -
explorer, debugger, or verifier. It investigates and reports; the main agent
applies the findings. → [Agent tools](/docs/reference/agent-tools)

## Turn

One cycle of the agent: think, call tools, read results. Each tier has a turn
budget: 80, 200 or 300.

## Wall clock

The time limit on a single build: 20, 45 or 90 minutes by tier. A backstop
against a run wedged inside one turn, which the turn budget cannot catch.

## Next

- [Core concepts](/docs/start/core-concepts)
- [Agent tools](/docs/reference/agent-tools)
- [Limits](/docs/billing/limits)
