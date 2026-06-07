# tau

A terminal coding agent. `tau` connects to any of several LLM providers, runs
an agent loop, and lets the model use four tools — **read**, **write**,
**edit**, and **bash** — to inspect and change your project.

## Install

```bash
bun install
```

Run it directly:

```bash
bun run src/cli.ts --help     # or: bun start
```

Or link it as a global `tau` command:

```bash
bun link
tau --help
```

## Quick start

```bash
tau login                     # pick a provider, paste an API key
tau run "add a health check endpoint to the server"
```

Running `tau` with no arguments drops you into an interactive session.

## Commands

| Command | Description |
| --- | --- |
| `tau login [provider]` | Authenticate a provider with an API key. `--api-key <key>` for non-interactive. |
| `tau logout [provider]` | Remove stored credentials (interactive picker if no provider given). |
| `tau auth list` | Show which providers are authenticated. |
| `tau providers` | List providers and their auth status. |
| `tau providers default [id]` | Set the default provider. |
| `tau models [-p <provider>]` | List available models. |
| `tau models default [model]` | Set the default model. |
| `tau config` | Show config file locations and current settings. |
| `tau run [prompt...]` | Start the agent (default command — bare `tau` does the same). |

### `tau run` options

| Flag | Description |
| --- | --- |
| `-m, --model <id>` | Override the model for this run. |
| `-p, --provider <id>` | Override the provider for this run. |
| `--plan` / `--build` | Mode: **plan** = read-only investigation + a plan; **build** = full read/write/edit/bash. |
| `-C, --cwd <dir>` | Directory the agent treats as the project root. |
| `--once` | Run the prompt once and exit (no interactive REPL). |
| `--max-tokens <n>` | Max output tokens per model response. |

### In-session slash commands

`/help` · `/mode [plan|build]` · `/clear` · `/info` · `/exit`

## Modes

- **build** (default) — the model can read, write, edit files and run shell commands.
- **plan** — read-only tools only; the model investigates and returns an
  implementation plan without touching the filesystem.

## Providers & models

Anthropic, OpenAI, DeepSeek, and Google Gemini. All use API-key
authentication. Anthropic uses the native Messages API; the others use the
OpenAI-compatible chat-completions protocol. You must run `tau login` to store
an API key for a provider before you can use it.

Run `tau models` to see the full catalog.

## Configuration

State lives in `~/.tau/` (override with `TAU_CONFIG_DIR`):

- `auth.json` — credentials (API keys), written with `0600` perms.
- `config.json` — default provider, model, and mode.

## Development

```bash
bun run dev        # watch mode
bun test           # run the test suite
bun run typecheck  # tsc --noEmit
```

## Architecture

```
src/
  cli.ts                 entry point; wires up commands
  commands/              auth, providers, models, config, run (+ REPL)
  providers/registry.ts  provider + model catalog
  config/                config dir resolution + credential/preference storage
  agent/
    client.ts            unified Anthropic / OpenAI chat client
    session.ts           the agent loop (Session)
    tools/               read, write, edit, bash
```
