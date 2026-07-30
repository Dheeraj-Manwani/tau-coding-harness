---
title: FAQ
description: The questions people actually ask, answered straight.
section: help
order: 2
updated: 2026-07-30
---

## Do I own the code?

Yes. Push it to a GitHub repo you own, any time. It is an ordinary web project —
there is no tau runtime to depend on and nothing to eject from.

→ [GitHub](/docs/ship/github)

## What is it actually running?

A real Linux sandbox with Node, a package manager, a shell, and a live port. When
you see your app running in the preview, a dev server inside that sandbox is
genuinely serving it.

→ [Preview](/docs/workspace/preview)

## Can I edit code by hand?

Yes, in the browser, in a real editor. Your edit autosaves, and tau is told what
you changed — it receives the diff before its next turn, so your change survives.

The editor is web-only; a phone keyboard is the wrong tool for it.

→ [Files and the editor](/docs/workspace/files-and-editor)

## Which models does it use?

DeepSeek on Low and High, Kimi K2.7 Code on Max. Effort is what selects the model.

For the [AI gateway](/docs/ai/overview) your app asks for an alias — `tau-fast`,
`tau-smart`, `tau-max` — not a vendor id, so the mapping can move without breaking
deployed apps.

→ [Effort tiers](/docs/build/effort-tiers)

## What happens if I run out of credits?

The build stops cleanly. Whatever was written is on disk and in storage, the job
ends with a clear reason, and nothing is left broken.

Top up or upgrade, then send a follow-up — it continues from where it stopped.

→ [Credits](/docs/billing/credits)

## Can I cancel a build?

Any time, mid-turn. You are charged for the work that happened, not for the turns
that never ran.

→ [Iterating](/docs/build/iterating)

## Does my prompt train a model?

No. Tau's [Privacy Policy](/privacy) states that we do not use your prompts or
generated code to train AI models, and we do not sell or rent your personal data.

Your prompts and conversation context are sent to the model provider that serves
your build — that is how inference works — and the sub-processors we use are listed
in the privacy policy. Generated project files are retained so you can get back to
your work. You can request deletion of your account and all associated data by
email, and we complete it within 30 days.

## Can I deploy the app from tau?

**No.** Not yet.

Tau builds and runs your app in a sandbox on a temporary URL. To publish it, push
to GitHub and deploy from there — Vercel, Netlify, Fly, Render, Cloudflare Pages,
anything.

→ [Deploying](/docs/ship/deploying)

## Can I download a ZIP of my project?

No. GitHub is the route out. A private repo is free and works as an archive.

→ [Exporting](/docs/ship/exporting)

## If I edit my GitHub repo, does tau pick it up?

No. Pushing is one-directional — tau does not read your repo's tree. Treat a push
as an export, and do not develop in both places at once.

## Is there an undo, or checkpoints?

No. There are no checkpoints and no restore, and deleting a project is not
reversible.

Push to GitHub at points you might want to return to. That is your undo, and it is
a good one.

## Why does my preview URL keep dying?

Sandboxes are not permanent. Your files are — press **Start preview** and a fresh
sandbox is built from them.

→ [Troubleshooting](/docs/help/troubleshooting)

## Can I run two builds at once?

No. One job at a time per account. Every build has a real sandbox and a real spend
cap behind it, and letting one account run several is how a balance empties by
accident.

## Are all the effort tiers available on the free plan?

Yes, including Max. Nothing is behind the paywall — the plans differ in credits and
project slots, not features.

→ [Plans](/docs/billing/plans)

## My app can call an LLM without an API key?

Yes, and this is genuinely unusual. Ask tau to add AI and it mints you a
credential, injects it into the sandbox, and serves the inference itself — billed
to the same credits that paid for the build.

You need no SDK, no provider account, and no key of your own.

→ [AI overview](/docs/ai/overview)

## Is there an SLA or uptime guarantee?

No. Tau does not publish one. A service restart can drop an in-flight build; you
are not charged for work that did not happen, but you will need to resubmit.

## Is there an API to start builds programmatically?

No. The public HTTP surface is the AI gateway. Tau's own endpoints are
session-authenticated, unversioned, and not a contract to build against.

→ [HTTP API](/docs/reference/api)

## Can I share a preview link?

Not usefully. A sandbox URL is temporary and will stop working, possibly within the
hour. Deploy from your repo to share something durable.

## Is there a gallery of examples?

Not yet. When there is, it will be real generated projects with real screenshots
and their owners' consent — not invented ones.

## Next

- [Troubleshooting](/docs/help/troubleshooting)
- [Contact](/docs/help/contact)
- [What tau can build](/docs/build/what-tau-can-build)
