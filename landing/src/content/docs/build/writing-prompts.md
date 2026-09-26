---
title: Writing prompts
description: What makes a prompt tau can build well, and the four patterns that reliably waste credits.
section: build
order: 1
updated: 2026-07-30
---

Tau is good at building an app you have described and bad at guessing one you
haven't. Almost every disappointing build traces back to a prompt that left the
important decision to the model.

## The shape that works

Four things, in any order. None of them is technical.

**A noun.** What is this? "A habit tracker." "An invoice generator." "A landing
page for a bakery." One phrase that fixes the category.

**The data.** What does it hold, and what are the fields? This becomes your
schema, and it is the single highest-value sentence in any prompt.

**One screen you care about.** Naming a view — "a 7-day grid", "a table I can
sort", "a checkout with a summary" — stops tau guessing at layout.

**A constraint or two.** "Dark." "Works on a phone." "No login." Short
constraints do the work of a long design brief.

```text
An invoice generator. I add line items with a description, quantity
and unit price; it totals them with 18% GST and exports a PDF.
One page, print-friendly, no login.
```

## Say what, not how

Describe the outcome and let tau choose the mechanism.

| Instead of | Write |
|---|---|
| "Use a `useEffect` to fetch on mount" | "Load the list when the page opens" |
| "Add a Zustand store" | "The filter should survive navigating away and back" |
| "Wrap it in a `try/catch`" | "If the save fails, tell me instead of failing silently" |

The right-hand column also survives tau choosing a different framework than you
assumed, which it sometimes will.

## Name symptoms, not fixes

When something is wrong, describe what you observe.

> "The total is wrong when quantity is 0 — it shows NaN."

is worth more than

> "Add a null check in the total function."

You know the symptom for certain. The cause is what you want tau to find, and
prescribing a fix narrows it to your guess.

## Attach things

A screenshot of a layout you like, a PDF spec, a pasted table of sample data —
all of it goes in the composer, and tau extracts text from it before building.
See [Attachments](/docs/build/attachments).

A screenshot is usually a faster way to convey a layout than any paragraph.

## Build in passes

One message per meaningful chunk beats one message for the whole product.

1. **Pass one** — the core object and the one screen that shows it.
2. **Pass two** — the second screen, now that the data model exists.
3. **Pass three** — polish: empty states, validation, mobile, errors.

Each pass is cheaper than the last, gives you something you can look at, and
lets you correct course before the mistake gets built on.

> [!TIP]
> Send the risky pass on a higher effort and the polish passes on Low. Effort is
> per message. See [Effort tiers](/docs/build/effort-tiers).

## The four patterns that waste credits

**The whole product in one message.** Six screens in one prompt yields six
shallow screens, and the parts you cared about got the same attention as the
parts you didn't.

**The stack you don't need.** "Use Next.js with tRPC, Prisma and Tailwind" is a
set of constraints tau now has to satisfy. Unless you have a reason — you're
extending an existing codebase, or your host requires it — leave it out.

**The vague noun.** "An app to manage things." There is no schema in that
sentence, so tau invents one, and then you are editing someone else's data model.

**The re-litigated fix.** Sending "no, do it properly" three times costs three
builds. If two attempts have failed, change the description rather than the
insistence: say what you observe now, what you expected, and which file you
think is wrong.

## When tau asks you something

If the agent hits a decision it cannot make safely, it stops and asks rather
than guessing. Answer in the chat and it continues from where it paused. A
question is a good sign — it means the ambiguity was caught before it was built.

## Next

- [Effort tiers](/docs/build/effort-tiers)
- [Plans and todos](/docs/build/plans-and-todos)
- [What tau can build](/docs/build/what-tau-can-build)
