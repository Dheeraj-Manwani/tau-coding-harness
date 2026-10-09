/**
 * Publish-time rewrites of an app's server files, as pure functions.
 *
 * A published backend does not run where the preview does: it is a bundle on a
 * managed Node runtime with a network database, not a Bun process with PGlite on
 * local disk. These functions produce what has to change, from file contents
 * alone: no sandbox, no network, no model. The user's own files are never
 * edited; the results are written into a scratch copy at publish time
 * (doc/PUBLISHING.md C3, C5).
 *
 * Nothing here is called by Publish yet. Phase 1 builds and tests the logic;
 * Phase 4 wires it in.
 */
import { createHash } from "node:crypto";

// ── Reading TypeScript well enough to find a function body ───────────────────

/**
 * The index just past the closing quote of the string or template literal that
 * opens at `start`, or -1 when it never closes. A template's `${…}` is stepped
 * over with its own nesting, so a backtick inside an interpolation does not end
 * the literal.
 */
function skipQuoted(src: string, start: number): number {
  const quote = src[start]!;
  let i = start + 1;
  while (i < src.length) {
    const c = src[i]!;
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === quote) return i + 1;
    if (quote === "`" && c === "$" && src[i + 1] === "{") {
      i = skipBraces(src, i + 1);
      if (i === -1) return -1;
      continue;
    }
    i += 1;
  }
  return -1;
}

/** The index just past the `}` matching the `{` at `start`, skipping strings and comments. -1 if unbalanced. */
function skipBraces(src: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < src.length) {
    const c = src[i]!;
    if (c === '"' || c === "'" || c === "`") {
      i = skipQuoted(src, i);
      if (i === -1) return -1;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i);
      i = nl === -1 ? src.length : nl + 1;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      if (end === -1) return -1;
      i = end + 2;
      continue;
    }
    if (c === "{") depth += 1;
    if (c === "}") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
    i += 1;
  }
  return -1;
}

/** `initDb`'s body, without its braces; null when there is no such function. */
function initDbBody(clientTs: string): string | null {
  const head = /\bfunction\s+initDb\s*\([^)]*\)\s*(?::\s*[^{]+)?\{/.exec(clientTs);
  if (head) {
    const open = head.index + head[0].length - 1;
    const end = skipBraces(clientTs, open);
    return end === -1 ? null : clientTs.slice(open + 1, end - 1);
  }
  // `const initDb = async () => { … }`
  const arrow = /\b(?:const|let)\s+initDb\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::\s*[^=]+)?=>\s*\{/.exec(clientTs);
  if (arrow) {
    const open = arrow.index + arrow[0].length - 1;
    const end = skipBraces(clientTs, open);
    return end === -1 ? null : clientTs.slice(open + 1, end - 1);
  }
  return null;
}

/** The characters a static literal stands for. Only the escapes SQL can contain. */
function unescapeLiteral(raw: string): string {
  return raw.replace(/\\([`\\$'"])/g, "$1").replace(/\\n/g, "\n").replace(/\\t/g, "\t");
}

/**
 * The SQL an app creates its tables with, lifted out of `initDb()`.
 *
 * The scaffold writes `await client.exec(\`CREATE TABLE IF NOT EXISTS …\`)`, and
 * the agent is told to keep adding to that statement. Several `exec` calls are
 * joined in order, because each is a list of statements already. Anything that
 * would need running the code to know (a `${…}` in a template, an argument that
 * is a variable, a call that is not `exec`) returns null: a wrong guess here
 * would create the wrong tables in a user's production database.
 */
export function extractInitSql(clientTs: string): string | null {
  const body = initDbBody(clientTs);
  if (body === null) return null;

  const calls = [...body.matchAll(/\b[A-Za-z_$][\w$]*\s*\.\s*exec\s*\(/g)];
  if (calls.length === 0) return null;

  const parts: string[] = [];
  for (const call of calls) {
    let i = call.index! + call[0].length;
    while (/\s/.test(body[i] ?? "")) i += 1;
    const quote = body[i];
    if (quote !== "`" && quote !== "'" && quote !== '"') return null;

    const end = skipQuoted(body, i);
    if (end === -1) return null;
    const raw = body.slice(i + 1, end - 1);
    if (quote === "`" && raw.includes("${")) return null;

    // The argument must end the call: `exec(\`…\` + extra)` is not static.
    let j = end;
    while (/\s/.test(body[j] ?? "")) j += 1;
    if (body[j] !== ")" && body[j] !== ",") return null;

    const sql = unescapeLiteral(raw).trim();
    if (sql) parts.push(/;\s*$/.test(sql) ? sql : `${sql};`);
  }
  return parts.length > 0 ? parts.join("\n\n") : null;
}

/** Text safe to put between backticks in generated source. */
function templateSafe(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

/**
 * The production `server/db/client.ts`: the `pg` driver on `DATABASE_URL`, with
 * the same two exports as the PGlite file it replaces, so nothing that imports
 * it changes. `initDb()` runs the app's own table SQL, lifted from its current
 * file, once per cold start (it is all `IF NOT EXISTS`).
 *
 * Null when the SQL cannot be read (see {@link extractInitSql}); the caller
 * blocks the publish with a message instead of publishing the wrong database.
 */
export function productionDbClient(clientTs: string): string | null {
  const sql = extractInitSql(clientTs);
  if (sql === null) return null;
  return `import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 })
export const db = drizzle(pool, { schema })

let initialized = false
export async function initDb() {
  if (initialized) return
  await pool.query(\`${templateSafe(sql)}\`)
  initialized = true
}
`;
}

/**
 * The entry file written beside `server/index.ts` in the scratch copy. It hands
 * each request to the app's own `fetch`, so the user's file is untouched.
 * Confirmed against a real Lambda in Phase 4; kept this small so it is easy to
 * change then.
 */
export function lambdaEntry(): string {
  return `import { Hono } from 'hono'
import { streamHandle } from 'hono/aws-lambda'
import server from './index'

const app = new Hono()
app.all('*', (c) => server.fetch(c.req.raw))
export const handler = streamHandle(app)
`;
}

/**
 * A stable fingerprint of a schema's SQL, to tell whether it changed between two
 * publishes (doc/PUBLISHING.md C6). Comments and whitespace do not count, nor
 * does where a line breaks; the text of a string literal does, exactly.
 */
export function schemaHash(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const c = sql[i]!;
    if (c === "'") {
      // A SQL string: '' inside it is an escaped quote.
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") j += 2;
        else if (sql[j] === "'") break;
        else j += 1;
      }
      out += sql.slice(i, j + 1);
      i = j + 1;
    } else if (c === "-" && sql[i + 1] === "-") {
      const nl = sql.indexOf("\n", i);
      i = nl === -1 ? sql.length : nl;
    } else if (c === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
      out += " ";
    } else if (/\s/.test(c)) {
      while (i < sql.length && /\s/.test(sql[i]!)) i += 1;
      out += " ";
    } else {
      out += c;
      i += 1;
    }
  }
  const normalised = out
    .replace(/\s*([(),;])\s*/g, "$1")
    .trim()
    .replace(/;$/, "");
  return createHash("sha256").update(normalised).digest("hex");
}
