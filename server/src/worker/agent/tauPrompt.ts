/**
 * The system prompt for a generation-2 project (`tau-app-v2`).
 *
 * The text is `docs/tau.md`: what has to hold on every turn — who the agent is,
 * the rules, the decisions it makes unprompted — plus a one-level index of the
 * guides that hold everything else. This file only fills in the places where
 * that text depends on the project, or repeats a number the code enforces.
 *
 * ## What is here and what is not
 *
 * A line belongs in `tau.md` if getting it wrong breaks something *before* the
 * agent would have had a reason to look anything up: use Bun, don't restart the
 * server, don't put a key in a file, call `enable_ai` first. How to write a
 * route, lay out a table, pick a palette or find an image belongs in a guide
 * (`docs/index.ts`), which arrives when the agent starts on that part of the
 * app. The index is always in context rather than behind a tool for a reason:
 * a model reads a guide it has been told exists far more reliably than it goes
 * looking for one (doc/CONTEXT_AND_MEMORY_PLAN.md §3).
 *
 * ## What varies, and why so little
 *
 * The model provider caches a request by its prefix, so every byte of this
 * that differs between two requests costs the whole cached conversation.
 *
 *   - **Stack level.** An app starts frontend-only and is given a backend, then
 *     a database, in place. The stack lines and tier 3 of the ladder follow the
 *     level; nothing else moves. So the prompt changes at most twice in a
 *     project's life.
 *   - **Saved key names.** Last, so that saving a key changes only the end.
 *
 * Effort is not here at all: it rides on each request's own message
 * (`context/history.ts`).
 */
import { TEMPLATES, type TemplateKey } from "../templates/registry";
import { docIndex, readTauTemplate } from "./docs";
import { MEMORY_MAX_CHARS, MEMORY_SECTIONS } from "./context/memoryFile";

const FRONTEND =
  "Vite + React + TypeScript + Tailwind v4 + shadcn/ui";

const API_LINE =
  "- API: routes go on the existing Hono `app` in `server/index.ts`, and the frontend calls them with **relative** `/api/*` URLs. The server restarts itself when a file under `server/` is saved. The `backend` guide has the rules — follow it.";

/** The lines describing how far this app's stack has grown. */
function stackLines(key: TemplateKey): string {
  const { hasServer, hasDb } = TEMPLATES[key];

  if (hasDb) {
    return `- Stack: ${FRONTEND} (frontend); Hono on Bun (API in \`server/index.ts\`, port 3000); PGlite + Drizzle database in \`server/db/\`, **already set up and wired** — do NOT reinstall or re-scaffold it.
${API_LINE}
- Database: tables live in \`server/db/schema.ts\`, and every table is mirrored in \`initDb()\` in \`server/db/client.ts\`. The \`database\` guide has the rules — follow it.`;
  }
  if (hasServer) {
    return `- Stack: ${FRONTEND} (frontend); Hono on Bun (API in \`server/index.ts\`, port 3000). **No database yet** — if the app needs data stored on the server, call \`add_database\`.
${API_LINE}`;
  }
  return `- Stack: ${FRONTEND}. **Frontend only so far — no server and no database.** Both can be added in place, without rebuilding anything, when the app genuinely needs them: \`add_backend\` sets up a Hono API and \`add_database\` sets up a Postgres database. Call the tool rather than creating \`server/\` yourself — it installs what is needed, starts the server, and returns the guide to follow.`;
}

/**
 * Tier 3 of the complexity ladder. On a frontend-only app it is a tool call
 * away rather than unavailable; once the stack has grown, it is already there.
 */
function tierThree(key: TemplateKey): string {
  const { hasServer, hasDb } = TEMPLATES[key];

  if (hasDb) {
    return `**Tier 3 — Server API + Database (already set up)**
The Hono API and a PGlite + Drizzle database are in place. Use them for multi-user data, server-side logic, auth, or an explicitly requested API / "real" persistence — extend the schema and add routes, following the \`database\` and \`backend\` guides.`;
  }
  if (hasServer) {
    return `**Tier 3 — Server API (set up) + Database (on demand)**
The Hono API is in place — use it for server-side logic or an explicitly requested API. For data that must be stored on the server (multi-user data, auth, "real" persistence), call "add_database" first; it sets the database up and returns the guide.`;
  }
  return `**Tier 3 — Server API + Database (added on demand)**
Only when the request genuinely requires a backend: multi-user data, server-side logic, auth, or the user explicitly asks for an API or "real" persistence. Then call "add_backend" (server-side logic, API routes) or "add_database" (data stored on the server — it adds the backend too). Each sets things up in place and returns the guide to follow.`;
}

function savedKeys(secretNames: readonly string[]): string {
  if (secretNames.length === 0) return "";
  const names = [...secretNames].sort().map((n) => `\`${n}\``).join(", ");
  return `\n\n## Keys already saved for this project\n${names} — available as \`process.env.NAME\` in server code. Don't ask for these again unless the user says one is wrong.`;
}

/** Fill `{{name}}` slots. A slot with no value is a bug in this file, so it throws. */
function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`tau.md has no value for {{${name}}}`);
    return value;
  });
}

export function buildBaseAppPrompt(opts: {
  templateKey: TemplateKey;
  /** Keys the user has already saved for this project (names only). */
  secretNames?: readonly string[];
}): string {
  return fill(readTauTemplate(), {
    stack: stackLines(opts.templateKey),
    guides: docIndex(),
    tier3: tierThree(opts.templateKey),
    memory_sections: MEMORY_SECTIONS.map((s) => `"${s.replace(/^## /, "")}"`).join(", "),
    memory_max: MEMORY_MAX_CHARS.toLocaleString("en-US"),
    saved_keys: savedKeys(opts.secretNames ?? []),
  });
}
