---
title: Troubleshooting
description: The things that go wrong, in order of how often, and what to do about each.
section: help
order: 1
updated: 2026-07-30
---

## The preview URL doesn't work

**Most common problem, and usually not a problem.** Sandboxes do not live forever;
an idle one goes away and its URL stops answering.

**Fix:** press **Start preview**. It reconnects or provisions a new sandbox,
rehydrates it from your stored files, and starts the dev server.

Your code is unaffected — files are stored independently of any sandbox. What a
dead sandbox costs you is the running process.

> [!TIP]
> Press **Start preview** rather than re-prompting. Re-prompting spends credits on
> an agent you did not need.

## The build stopped early

Check the finish reason in the chat.

| Reason | What to do |
|---|---|
| Out of credits | Top up, then send a follow-up — it continues from where it stopped |
| Out of turns | Follow up, or use a higher [effort tier](/docs/build/effort-tiers) |
| Out of wall clock | Usually something wedged. Retry |
| Failed | Read the last few tool lines — the error is normally right there |

Nothing is lost in any of these cases. Whatever was written is on disk and in
storage.

## My build vanished

If tau's service restarted while your job was running, that job is gone. The row is
cleaned up so nothing about your project is broken, but the work is lost.

**Fix:** resubmit. You are not charged for work that did not happen.

This is a known limitation of the current architecture, not a transient bug.

## A build won't start

| Message | Cause | Fix |
|---|---|---|
| Insufficient credits | Balance too low to start | [Top up](/docs/billing/credit-packs) |
| Concurrent job limit | A build is already running | Wait, or cancel it |
| Project limit reached | 3 projects on Free | Delete one (push it first) or upgrade |

→ [Errors](/docs/reference/errors)

## The app builds but the page is blank

The dev server is answering, so tau considers it running — but something fails at
runtime.

**Fix:** tell tau what you see. "The page is blank and the console says
`Cannot read properties of undefined`" gets fixed in one turn. "It's broken" does
not.

If you can open the browser console, paste the error. That is the single most
useful thing you can provide.

## Tau keeps undoing my edit

It shouldn't — tau is told about every hand edit via a diff before its next turn.
If it is genuinely overwriting your change, the usual cause is that the edit never
saved.

**Check:** the tab's dirty indicator. Saves happen on ⌘S, on blur, and after 2
seconds idle. If a job was running, the save was blocked — editing is disabled
during a build.

→ [Files and the editor](/docs/workspace/files-and-editor)

## I got a 409 saving a file

The file changed since you opened it, usually because the agent rewrote it. The
save was refused rather than overwriting.

**Fix:** reopen the file, look at the current version, reapply your change.

## My AI feature returns 401

`invalid_api_key`. Three usual causes:

- **The key was rotated** and the old one is past its 24-hour grace window. Update
  `TAU_API_KEY` where you deployed.
- **Revoke-all was used.** Every key died immediately. Mint a new one.
- **The variable isn't set** on the host you deployed to. The sandbox's copy does
  not travel.

→ [API keys](/docs/ai/api-keys)

## My AI feature returns 402 or 429

| Code | Meaning | Fix |
|---|---|---|
| `insufficient_credits` | The account is out | Top up |
| `daily_cap_exceeded` | Over the key's daily cap | Wait for 00:00 UTC, or raise the cap |
| `rate_limit_exceeded` | Over 60 requests/minute | Back off and retry |
| `concurrency_limit_exceeded` | Too many in flight | Retry shortly |

If a deployed app is hitting the daily cap unexpectedly, check whether the endpoint
is public and being called by something other than your users. That is precisely
what the cap is for.

## My credits went down and I wasn't building

Check the **spend split** on your billing page. Runtime spend is your deployed app
calling the [AI gateway](/docs/ai/overview) — its traffic, your credits.

Set the [daily cap](/docs/ai/api-keys) to bound it.

## The `.env` disappeared after a rebuild

Expected. Credential-shaped files are never persisted, so a new sandbox does not
have them. → [Secrets](/docs/ship/secrets)

Tau's own AI variables are re-injected automatically. Anything you added by hand
you will need to add again.

## Attachments aren't reaching the agent

You probably sent while an attachment was still extracting. Wait for the chip to
read **Ready**, then send.

→ [Attachments](/docs/build/attachments)

## Tau built the wrong thing

Usually the prompt left the important decision to the model. Two things help more
than repeating yourself:

**Read the plan.** It appears before any code, and a wrong plan is the cheapest
possible place to catch a misunderstanding.

**Describe the gap, not the fix.** "The list should group by date, and it's
currently flat" beats "no, do it properly" — and beats it by more the second and
third time.

→ [Writing prompts](/docs/build/writing-prompts)

## Still stuck

[Contact support](/docs/help/contact). Include the project, roughly when, what you
expected, and what happened.

## Next

- [FAQ](/docs/help/faq)
- [Errors](/docs/reference/errors)
- [Contact](/docs/help/contact)
