---
title: A public front door, and documentation
date: 2026-07-30
---

Tau has a landing page and a documentation site.

- **A public `/`.** Previously the root was the builder, behind auth: a
  logged-out visitor was bounced to the login screen with nothing to read. The
  product now lives at `/app` and `/` is the page you can share.
- **41 pages of docs** at [`/docs`](/docs), covering getting started, building,
  the workspace, shipping, the AI gateway, billing, mobile, and a full reference.
  Searchable with `⌘K`.
- **Every number in the docs traces to a constant in the code** rather than to
  someone's memory of it. Where something isn't built, the page says so and says
  what to do instead: [Deploying](/docs/ship/deploying) is the honest example.
