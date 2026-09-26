---
title: Secrets
description: Credential-shaped files never enter your project's manifest, so deleting your .gitignore still cannot publish a key.
section: ship
order: 2
updated: 2026-07-30
---

Secrets are stopped at the earliest possible point: they never enter your
project's stored file manifest at all.

That matters because the manifest is what a GitHub push publishes. Filtering at
push time would mean the bytes were already stored and one missed code path
publishes them. Filtering at write time means there is nothing to leak.

## What counts as a secret

| Pattern | Examples |
|---|---|
| Any dotenv file | `.env`, `.env.local`, `.env.production`, `.env.example` |
| Private keys, certs, keystores | `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.jks`, `*.keystore`, `*.asc`, `*.gpg` |
| SSH keys | `id_rsa`, `id_ed25519`, `id_ecdsa`, `id_dsa` (and suffixed variants) |
| Tool credentials | `.npmrc`, `.netrc`, `.pypirc`, `.dockercfg`, `docker/config.json` |
| Whole directories | `.git/`, `.ssh/`, `.aws/`, `.gnupg/` |

Nesting does not help: `server/.env` is treated exactly like a root `.env`,
because it is exactly as dangerous.

`.env.example` is included deliberately. Placeholder env files are a real
convention, but the templates' own `.gitignore` already excludes `.env.*`, so
allowing them here would buy nothing and would require tau to judge which
placeholder files are actually safe.

## The two-layer order

A push filters in this order, and the order is the whole design:

1. **The secret floor** — the patterns above, unconditionally.
2. **Your project's root `.gitignore`** — build output, `node_modules`, on-disk
   data directories, anything else you have excluded.

> [!NOTE]
> Because the floor runs first, editing or deleting your `.gitignore` cannot
> cause a key to be published. The `.gitignore` layer exists to keep build
> artefacts out of your repo, not to protect credentials.

Only the root `.gitignore` is read. Real git also honours per-directory ones; no
tau template writes any, and the floor covers the case that matters.

## What this means in the sandbox

The agent can still *write* a `.env` in the sandbox — your app may genuinely need
one to run, and the preview needs it to work.

What happens is that the file exists on the machine and is not persisted. Tau
tells the agent so explicitly, rather than letting it assume the write was
durable and be surprised after a rebuild.

The practical consequence for you: **a `.env` does not survive a sandbox
rebuild.** If tau wired the AI gateway in, it re-injects those variables on every
provision, so those are handled. Anything you added by hand you will need to add
again.

## Your own third-party keys

If your app needs a Stripe key, an OpenAI key, or anything else of yours:

- Set it in the sandbox for the preview to work.
- Expect to set it again after a rebuild.
- Set it on your host when you deploy — the sandbox's copy does not travel.

Tau's own AI credential is the exception, because tau manages it. See
[API keys](/docs/ai/api-keys).

## What is not protected

The floor is a pattern match on paths. It does not scan file *contents*. A key
pasted into `src/config.ts` is an ordinary source file as far as tau is
concerned, and it will be pushed.

> [!WARNING]
> Do not hardcode credentials in source. The floor cannot help you there — read
> from the environment instead, and tell tau to do the same.

## Next

- [GitHub](/docs/ship/github)
- [API keys](/docs/ai/api-keys)
- [Deploying](/docs/ship/deploying)
