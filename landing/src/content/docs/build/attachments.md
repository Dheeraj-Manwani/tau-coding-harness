---
title: Attachments
description: Images, PDFs and pasted content in the composer — what tau does with them, the size limits, and what mobile omits.
section: build
order: 5
updated: 2026-07-30
---

You can attach files to any message. A screenshot of a layout is usually a faster
way to describe a design than a paragraph, and a spec you already have is better
than a spec you retype.

## What you can attach

- **Images** — screenshots, mockups, photos of a whiteboard.
- **Documents** — PDFs and text files.
- **Pasted content** — paste a table, a log, or a block of text straight into the
  composer and it becomes an attachment instead of a wall of prompt.

## Limits

| Limit | Value |
|---|---|
| Max file size | 10 MB |
| Max image size | 5 MB |
| Max attachments per message | 5 |

These are the defaults tau runs with. A file over the limit is rejected at upload
rather than silently truncated.

## What happens to them

1. The file uploads directly to storage from your browser.
2. Tau extracts its text content — a PDF becomes text, an image is described.
3. You see the chip go from **Extracting** to **Ready**.
4. When you send, the extracted text is folded into the message the agent reads.

That last step matters for understanding cost and behaviour: the agent works from
extracted **text**, which is part of your message. It is not re-reading the
original file on every turn.

> [!NOTE]
> Attach the file, wait for **Ready**, then send. Sending while an attachment is
> still extracting means the agent gets the message without its content.

## Using attachments well

**A screenshot for layout.** "Like this, but our colours" with a screenshot
attached is one sentence that replaces a design brief.

**A PDF for requirements.** If you already have a spec, attach it and write one
line about which part to build first. Do not paste the whole thing into the
prompt box.

**Sample data as a paste.** Paste ten representative rows. Tau will infer the
schema from real data more reliably than from your description of it.

**A screenshot of the bug.** Something rendering wrong is much easier to fix from
a picture than from a description of the picture.

## On mobile

The mobile app supports camera, photo library, and file attachments.

It deliberately does **not** support paste-to-attach — that is a web-only
affordance. On mobile, paste goes into the prompt text like any other paste.

## Housekeeping

Attachments you upload but never send are swept periodically. An attachment on a
sent message stays with that message, for provenance and so the chat still makes
sense when you scroll back to it.

## Next

- [Writing prompts](/docs/build/writing-prompts)
- [Mobile parity](/docs/mobile/parity) — everything the app leaves out, and why
- [Limits](/docs/billing/limits)
