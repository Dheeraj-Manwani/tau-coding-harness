/**
 * What changed between two publishes of an app's database SQL (doc/PUBLISHING.md C6).
 *
 * An app's `initDb()` only runs `CREATE TABLE IF NOT EXISTS …`. On the second
 * publish that silently does nothing for a table that already exists: a column
 * the agent added to the statement never reaches the published database, and the
 * first query that uses it fails. So this compares the old and new SQL table by
 * table and column by column and answers two things:
 *
 *   - `additive`: statements tau can add itself without touching data
 *     (`ALTER TABLE … ADD COLUMN IF NOT EXISTS …`), which the production client
 *     runs after the app's own SQL;
 *   - `changes`: everything that cannot be applied safely (a column removed or
 *     retyped, a table dropped, a new column that is required but has no default).
 *     These stop the publish until the owner confirms, and are never applied to
 *     existing data.
 *
 * It reads SQL text, never runs it, and treats anything it does not understand
 * as a change rather than guessing.
 */

export type ChangeKind =
  | "drop_table"
  | "drop_column"
  | "type_change"
  | "column_modified"
  | "required_column"
  | "other_statement";

export interface SchemaChange {
  kind: ChangeKind;
  table: string | null;
  column: string | null;
  /** One line the panel shows the owner. */
  message: string;
}

export interface SchemaDiff {
  additive: string[];
  changes: SchemaChange[];
}

// ── Reading the SQL ──────────────────────────────────────────────────────────

/** The text with line comments and block comments removed, string literals kept exactly. */
function stripComments(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const c = sql[i]!;
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === c) {
          if (sql[j + 1] === c) j += 2;
          else break;
        } else j += 1;
      }
      out += sql.slice(i, j + 1);
      i = j + 1;
    } else if (c === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i += 1;
    } else if (c === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
      out += " ";
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

/** Split on `sep` outside quotes and parentheses. */
function splitTop(text: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === c) {
          if (text[j + 1] === c) j += 2;
          else break;
        } else j += 1;
      }
      i = j + 1;
      continue;
    }
    if (c === "(") depth += 1;
    else if (c === ")") depth -= 1;
    else if (c === sep && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
    i += 1;
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

function unquote(name: string): string {
  const n = name.trim();
  return (n.startsWith('"') && n.endsWith('"') ? n.slice(1, -1) : n).toLowerCase();
}

interface Column {
  name: string;
  /** The definition after the name, whitespace collapsed. */
  definition: string;
  type: string;
  notNull: boolean;
  hasDefault: boolean;
}

interface Table {
  name: string;
  /** `public.items` and `items` are the same table. */
  columns: Map<string, Column>;
  hasIfNotExists: boolean;
}

const CONSTRAINT_START = /^(?:constraint|primary\s+key|foreign\s+key|unique|check|exclude|like)\b/i;
const TYPE_STOP = /\s(?:not\s+null|null|default|primary\s+key|references|unique|check|generated|constraint|collate)\b/i;

function parseColumn(item: string): Column | null {
  const m = item.match(/^("(?:[^"]|"")+"|[A-Za-z_][\w$]*)\s+([\s\S]+)$/);
  if (!m) return null;
  const name = unquote(m[1]!);
  const definition = collapse(m[2]!);
  const stop = definition.search(TYPE_STOP);
  const type = (stop === -1 ? definition : definition.slice(0, stop)).trim().toLowerCase();
  const lower = definition.toLowerCase();
  const isSerial = /^(?:big|small)?serial\b/.test(type);
  return {
    name,
    definition,
    type,
    notNull: /\bnot\s+null\b/.test(lower) || /\bprimary\s+key\b/.test(lower),
    // `serial` fills itself in, so a new serial column needs no default from the owner.
    hasDefault: /\bdefault\b/.test(lower) || isSerial || /\bgenerated\b/.test(lower),
  };
}

function parseCreateTable(statement: string): Table | null | "unreadable" {
  const m = statement.match(/^create\s+(?:unlogged\s+)?table\s+(if\s+not\s+exists\s+)?((?:"[^"]+"|[\w$]+)(?:\s*\.\s*(?:"[^"]+"|[\w$]+))?)\s*\(([\s\S]*)\)\s*$/i);
  if (!m) return /^create\s+(?:unlogged\s+)?table\b/i.test(statement) ? "unreadable" : null;
  const name = m[2]!
    .split(".")
    .map(unquote)
    .filter((part, index, all) => !(all.length === 2 && index === 0 && part === "public"))
    .join(".");
  const columns = new Map<string, Column>();
  for (const item of splitTop(m[3]!, ",")) {
    if (CONSTRAINT_START.test(item)) continue;
    const column = parseColumn(item);
    if (!column) return "unreadable";
    columns.set(column.name, column);
  }
  return { name, columns, hasIfNotExists: !!m[1] };
}

/** Statements of one SQL text, comments gone, each whitespace-collapsed. */
export function statementsOf(sql: string): string[] {
  return splitTop(stripComments(sql), ";").map(collapse).filter(Boolean);
}

interface Parsed {
  tables: Map<string, Table>;
  indexes: Set<string>;
  others: string[];
  unreadable: string[];
}

function parse(sql: string): Parsed {
  const out: Parsed = { tables: new Map(), indexes: new Set(), others: [], unreadable: [] };
  for (const statement of statementsOf(sql)) {
    const table = parseCreateTable(statement);
    if (table === "unreadable") {
      out.unreadable.push(statement);
    } else if (table) {
      out.tables.set(table.name, table);
    } else if (/^create\s+(?:unique\s+)?index\b/i.test(statement)) {
      out.indexes.add(statement.toLowerCase());
    } else {
      out.others.push(statement);
    }
  }
  return out;
}

// ── Comparing ────────────────────────────────────────────────────────────────

const quoteName = (name: string) => name.split(".").map((p) => `"${p.replace(/"/g, '""')}"`).join(".");

/**
 * What changed from `oldSql` (the live deployment's) to `newSql`.
 *
 * Statements tau cannot read are changes, not guesses: an unreadable table in
 * the new SQL means tau cannot say whether publishing it is safe.
 */
export function diffSchema(oldSql: string, newSql: string): SchemaDiff {
  const before = parse(oldSql);
  const after = parse(newSql);
  const diff: SchemaDiff = { additive: [], changes: [] };
  const change = (kind: ChangeKind, table: string | null, column: string | null, message: string) =>
    diff.changes.push({ kind, table, column, message });

  for (const statement of after.unreadable) {
    if (!before.unreadable.includes(statement)) {
      change("other_statement", null, null, `Tau could not read this statement, so it cannot tell whether it is safe: ${statement.slice(0, 120)}`);
    }
  }

  for (const [name, table] of after.tables) {
    if (!table.hasIfNotExists) {
      change("other_statement", name, null, `CREATE TABLE ${name} has no IF NOT EXISTS, so it would fail the second time the server starts.`);
    }
    const old = before.tables.get(name);
    if (!old) continue; // a new table: the app's own SQL creates it
    for (const [columnName, column] of table.columns) {
      const was = old.columns.get(columnName);
      if (!was) {
        if (column.notNull && !column.hasDefault) {
          change(
            "required_column",
            name,
            columnName,
            `${name}.${columnName} is new and required but has no default, so it cannot be added to a table that already has rows.`,
          );
        } else {
          diff.additive.push(`ALTER TABLE ${quoteName(name)} ADD COLUMN IF NOT EXISTS ${quoteName(columnName)} ${column.definition};`);
        }
      } else if (was.type !== column.type) {
        change("type_change", name, columnName, `${name}.${columnName} changed from ${was.type} to ${column.type}.`);
      } else if (was.definition !== column.definition) {
        change("column_modified", name, columnName, `${name}.${columnName} changed from "${was.definition}" to "${column.definition}".`);
      }
    }
    for (const columnName of old.columns.keys()) {
      if (!table.columns.has(columnName)) {
        change("drop_column", name, columnName, `${name}.${columnName} was removed from the schema. Its data stays in the published database.`);
      }
    }
  }
  for (const name of before.tables.keys()) {
    if (!after.tables.has(name)) {
      change("drop_table", name, null, `Table ${name} was removed from the schema. Its data stays in the published database.`);
    }
  }

  // New statements of another kind: an index that is new is fine (it is
  // IF NOT EXISTS or the app's own SQL would fail on the second start).
  for (const index of after.indexes) {
    if (!before.indexes.has(index) && !/\bif\s+not\s+exists\b/.test(index)) {
      change("other_statement", null, null, `This index has no IF NOT EXISTS, so it would fail the second time the server starts: ${index.slice(0, 120)}`);
    }
  }
  for (const statement of after.others) {
    if (!before.others.includes(statement)) {
      change("other_statement", null, null, `A statement other than CREATE TABLE / CREATE INDEX was added: ${statement.slice(0, 120)}`);
    }
  }
  return diff;
}

/** Whether publishing needs the owner to confirm. */
export const needsConfirmation = (diff: SchemaDiff): boolean => diff.changes.length > 0;
