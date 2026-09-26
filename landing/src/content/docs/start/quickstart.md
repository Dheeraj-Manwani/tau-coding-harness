---
title: Quickstart
description: From signup to a running app, in about five minutes.
section: start
order: 2
updated: 2026-07-30
---

You need an email address. You do not need a card, a CLI, a template, or
anything installed.

## 1. Make an account

Sign up at [app.tauai.pro](/signup) and verify your email. New accounts get
**300 credits**, once. That is enough for several small builds.

## 2. Describe what you want

You land in the builder with a prompt box. Write one or two sentences about the
app you want. Be concrete about the parts you care about and let tau pick the
rest.

```text
A recipe box. I add recipes with a title, ingredients and steps,
and can search them by ingredient. Clean, warm colours, works on a phone.
```

> [!TIP]
> Naming the shape of your data ("title, ingredients, steps") is worth more than
> naming a framework. See [Writing prompts](/docs/build/writing-prompts).

## 3. Pick an effort

The selector under the box sets how hard tau works. **High** is the right
default for a first real app. Low is for tweaks; Max is for big multi-file
builds.

## 4. Send it, and watch

Tau creates a project, provisions a Linux sandbox, and starts an agent. From
here everything streams to your screen as it happens:

1. **A plan** — a todo list, written before any code, ticking over as it goes.
2. **Files** — appearing in the tree as they land.
3. **Commands** — installs and builds, with their output.
4. **A preview** — your app on a live URL inside the sandbox, in an iframe you
   can click.

You can close the tab. Come back and the stream resumes where it was.

## 5. Change something

Type a follow-up in the same chat:

```text
Make the search filter as I type instead of on submit.
```

Tau picks up the existing project — same sandbox, same files — and edits it.
Effort is per message, so you can send this one on a different tier.

You can also open a file in the editor and change it yourself. Tau is told what
you edited, so your change survives its next turn. See
[Files and the editor](/docs/workspace/files-and-editor).

## 6. Take the code

Connect GitHub from inside the project, then push — a new pull request, an
update to an existing one, or straight to a branch.

Tau does not deploy for you. Once the code is in your repo, deploy it from
there. See [Deploying](/docs/ship/deploying).

## When something goes wrong

- **The build stopped early.** Check your balance — a build stops cleanly when
  it hits its spend cap or your credits run out.
- **The preview URL is dead.** Sandboxes do not live forever. Hit
  **Start preview** to rebuild one from your files.
- **Anything else** — [Troubleshooting](/docs/help/troubleshooting).

## Next

- [Core concepts](/docs/start/core-concepts) — the five words that explain the rest of these docs.
- [Your first prompt](/docs/start/your-first-prompt) — a worked example, start to finish.
- [Effort tiers](/docs/build/effort-tiers) — what Low, High and Max actually change.
