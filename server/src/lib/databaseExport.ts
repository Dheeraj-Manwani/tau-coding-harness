/**
 * The owner's data, as files (doc/PUBLISHING.md 5.7): one CSV per table in the
 * published database, plus the schema SQL the app was published with, in a zip.
 * Loading it into an empty Postgres is `schema.sql` and then each CSV with `\copy`.
 *
 * Read-only, through a transaction that cannot write, and capped: a table too
 * large for this is exported up to the cap and the file says so.
 */
import { Client } from "pg";
import { strToU8, zipSync } from "fflate";

const MAX_ROWS_PER_TABLE = 100_000;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;

/** One CSV value: quoted when it has a comma, quote, or line break; dates as ISO; objects as JSON. */
export function csvValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text =
    value instanceof Date
      ? value.toISOString()
      : value instanceof Uint8Array
        ? `\\x${Buffer.from(value).toString("hex")}`
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(columns: string[], rows: unknown[][]): string {
  return [columns.map(csvValue).join(","), ...rows.map((r) => r.map(csvValue).join(","))].join("\r\n") + "\r\n";
}

/**
 * `ALTER TABLE … ADD COLUMN` for columns that hold data in the database but are
 * not in the schema the app was published with (a column removed from the
 * schema keeps its data), so the CSVs load into the schema file as exported.
 */
export function missingColumnsSql(schemaSql: string, columns: { table: string; column: string; type: string }[]): string {
  const lines: string[] = [];
  for (const { table, column, type } of columns) {
    const block = new RegExp(`create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?"?${table}"?\\s*\\(([\\s\\S]*?)\\n\\s*\\)\\s*;`, "i").exec(schemaSql);
    if (block && new RegExp(`(^|[\\s(,"])${column}("|\\s)`, "i").test(block[1] ?? "")) continue;
    lines.push(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "${column}" ${type};`);
  }
  return lines.length ? `\n-- Columns that hold data but are no longer in the app's schema.\n${lines.join("\n")}` : "";
}

const quoteIdent =(name: string) => `"${name.replace(/"/g, '""')}"`;

export interface DatabaseExport {
  zip: Uint8Array;
  tables: number;
  rows: number;
  /** Tables cut off at the row cap. */
  truncated: string[];
}

export async function exportDatabase(connectionString: string, schemaSql: string | null): Promise<DatabaseExport> {
  const client = new Client({ connectionString, connectionTimeoutMillis: 15_000, statement_timeout: 60_000 });
  await client.connect();
  const files: Record<string, Uint8Array> = {};
  const truncated: string[] = [];
  let rows = 0;
  let bytes = 0;
  try {
    await client.query("BEGIN READ ONLY");
    const tables = await client.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name",
    );
    for (const { table_name: table } of tables.rows) {
      const result = await client.query({ text: `SELECT * FROM ${quoteIdent(table)} LIMIT ${MAX_ROWS_PER_TABLE + 1}`, rowMode: "array" });
      const cut = result.rows.length > MAX_ROWS_PER_TABLE;
      const data = cut ? result.rows.slice(0, MAX_ROWS_PER_TABLE) : result.rows;
      const csv = strToU8(toCsv(result.fields.map((f) => f.name), data as unknown[][]));
      bytes += csv.byteLength;
      if (bytes > MAX_TOTAL_BYTES) throw new Error("This database is too large to export here. Contact support for a full copy.");
      files[`${table}.csv`] = csv;
      rows += data.length;
      if (cut) truncated.push(table);
    }
    if (schemaSql) {
      const cols = await client.query<{ table: string; column: string; type: string }>(
        `SELECT c.relname AS "table", a.attname AS "column", format_type(a.atttypid, a.atttypmod) AS "type"
         FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
         ORDER BY c.relname, a.attnum`,
      );
      schemaSql += missingColumnsSql(schemaSql, cols.rows);
    }
    await client.query("ROLLBACK");
  } finally {
    await client.end().catch(() => {});
  }
  if (schemaSql) files["schema.sql"] = strToU8(`${schemaSql}\n`);
  if (truncated.length > 0) {
    files["README.txt"] = strToU8(`These tables were cut off at ${MAX_ROWS_PER_TABLE} rows: ${truncated.join(", ")}.\n`);
  }
  return { zip: zipSync(files), tables: Object.keys(files).filter((f) => f.endsWith(".csv")).length, rows, truncated };
}
