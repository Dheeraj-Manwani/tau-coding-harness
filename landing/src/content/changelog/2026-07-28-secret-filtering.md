---
title: Secrets can't leak, and jobs can't go quiet
date: 2026-07-28
---

- **Credential-shaped files are never persisted.** Dotenv files, private keys,
  certs, SSH keys and tool credentials are stopped at write time, so they never
  enter your project's manifest and therefore cannot be pushed. The filter runs
  *before* your `.gitignore`, as a hard floor: deleting your `.gitignore` still
  cannot publish a key.
- **A build that stalls is now cleaned up.** Jobs report a heartbeat each turn,
  and one that goes cold is terminated rather than sitting as a run that looks
  live forever. Nothing about your project is left in a broken state.
- **A clearer reason for why a build ended.** Finished, cancelled, out of turns,
  out of wall clock, out of credits, or failed: separated from whether it
  succeeded.

→ [Secrets](/docs/ship/secrets)
