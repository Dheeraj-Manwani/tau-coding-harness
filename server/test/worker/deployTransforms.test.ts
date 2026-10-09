import { describe, expect, test } from "bun:test";
import {
  extractInitSql,
  lambdaEntry,
  productionDbClient,
  schemaHash,
} from "@/worker/lib/deployTransforms";
import { DB_CLIENT_TS } from "@/worker/templates/shared";

// The publish-time rewrites of an app's server files. They decide what goes
// into a user's production database, so the rule everywhere is: lift exactly
// what the file says, and return null rather than guess.

const THREE_TABLES = `import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import * as schema from './schema'

const client = new PGlite('./data/pgdata')
export const db = drizzle(client, { schema })

let initialized = false
export async function initDb() {
  if (initialized) return
  await client.exec(\`
    CREATE TABLE IF NOT EXISTS items (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      item_id INTEGER REFERENCES items(id),
      note TEXT DEFAULT 'it''s fine'
    );
    CREATE TABLE IF NOT EXISTS customers (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE
    );
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS qty INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS name TEXT;
  \`)
  initialized = true
}
`;

describe("extractInitSql", () => {
  test("lifts the scaffold's table SQL", () => {
    const sql = extractInitSql(DB_CLIENT_TS)!;
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS items");
    expect(sql).toContain("created_at TIMESTAMP NOT NULL DEFAULT now()");
    expect(sql.trimEnd()).toEndWith(");");
    expect(sql).not.toContain("exec");
  });

  test("lifts three tables and two ALTER lines, in order, quotes intact", () => {
    const sql = extractInitSql(THREE_TABLES)!;
    expect(sql.match(/CREATE TABLE IF NOT EXISTS/g)).toHaveLength(3);
    expect(sql.match(/ALTER TABLE/g)).toHaveLength(2);
    expect(sql).toContain("DEFAULT 'it''s fine'");
    expect(sql.indexOf("items")).toBeLessThan(sql.indexOf("customers"));
    expect(sql.indexOf("CREATE TABLE IF NOT EXISTS customers")).toBeLessThan(sql.indexOf("ALTER TABLE orders"));
  });

  test("joins several exec calls, each ended with a semicolon", () => {
    const sql = extractInitSql(`
      export async function initDb() {
        await client.exec('CREATE TABLE IF NOT EXISTS a (id INT)')
        await client.exec("CREATE TABLE IF NOT EXISTS b (id INT);")
        await client.exec(\`ALTER TABLE a ADD COLUMN IF NOT EXISTS x INT\`)
      }`)!;
    expect(sql).toBe(
      "CREATE TABLE IF NOT EXISTS a (id INT);\n\nCREATE TABLE IF NOT EXISTS b (id INT);\n\nALTER TABLE a ADD COLUMN IF NOT EXISTS x INT;",
    );
  });

  test("handles an arrow function and a typed return", () => {
    expect(extractInitSql("export const initDb = async () => { await client.exec(`CREATE TABLE IF NOT EXISTS a (id INT)`) }")).toContain("TABLE IF NOT EXISTS a");
    expect(extractInitSql("export async function initDb(): Promise<void> { await client.exec(`SELECT 1`) }")).toBe("SELECT 1;");
  });

  test("a brace or a backtick in a comment or a string does not end the function early", () => {
    const sql = extractInitSql(`
      export async function initDb() {
        // a } and a \` in a comment
        const note = "} {"
        await client.exec(\`CREATE TABLE IF NOT EXISTS a (id INT)\`)
      }`);
    expect(sql).toContain("TABLE IF NOT EXISTS a");
  });

  test("interpolation is refused", () => {
    expect(
      extractInitSql("export async function initDb() { await client.exec(`CREATE TABLE ${name} (id INT)`) }"),
    ).toBeNull();
    // One bad call spoils the lot: the rest would be a partial schema.
    expect(
      extractInitSql(
        "export async function initDb() { await client.exec(`CREATE TABLE a (id INT)`); await client.exec(`CREATE TABLE ${t} (id INT)`) }",
      ),
    ).toBeNull();
  });

  test("a variable, a concatenation or a different call is refused", () => {
    expect(extractInitSql("export async function initDb() { await client.exec(SCHEMA_SQL) }")).toBeNull();
    expect(extractInitSql("export async function initDb() { await client.exec('CREATE TABLE a (id INT)' + more) }")).toBeNull();
    expect(extractInitSql("export async function initDb() { await migrate(db, { migrationsFolder: './drizzle' }) }")).toBeNull();
  });

  test("no initDb, or an empty one, is null", () => {
    expect(extractInitSql("export const db = 1")).toBeNull();
    expect(extractInitSql("export async function initDb() {}")).toBeNull();
    expect(extractInitSql("export async function initDb() {")).toBeNull();
  });
});

describe("productionDbClient", () => {
  test("is the pg driver on DATABASE_URL with the same two exports", () => {
    const out = productionDbClient(DB_CLIENT_TS)!;

    expect(out).toContain("from 'drizzle-orm/node-postgres'");
    expect(out).toContain("from 'pg'");
    expect(out).toContain("connectionString: process.env.DATABASE_URL");
    expect(out).toContain("export const db = drizzle(pool, { schema })");
    expect(out).toContain("export async function initDb()");
    // Nothing of the preview's database survives.
    expect(out).not.toContain("pglite");
    expect(out).not.toContain("PGlite");
    expect(out).not.toContain("mkdirSync");
    expect(out).toContain("CREATE TABLE IF NOT EXISTS items");
  });

  test("carries every statement of a larger schema", () => {
    const out = productionDbClient(THREE_TABLES)!;
    expect(out.match(/CREATE TABLE IF NOT EXISTS/g)).toHaveLength(3);
    expect(out).toContain("ADD COLUMN IF NOT EXISTS qty");
  });

  // The SQL goes inside a template literal in generated source.
  test("SQL containing a backtick, a backslash or ${ stays one valid string", () => {
    const out = productionDbClient(
      "export async function initDb() { await client.exec('CREATE TABLE a (c TEXT DEFAULT \\'${x}\\' )') }",
    )!;
    const literal = /pool\.query\(`([\s\S]*)`\)/.exec(out)![1]!;
    expect(literal).toContain("\\${x}");
    // Evaluating the generated literal gives back the SQL that was lifted.
    expect(new Function(`return \`${literal}\``)()).toContain("${x}");
  });

  test("null when the SQL cannot be read", () => {
    expect(productionDbClient("export async function initDb() { await client.exec(sql) }")).toBeNull();
    expect(productionDbClient("export const x = 1")).toBeNull();
  });

  test("the generated file parses", () => {
    const out = productionDbClient(THREE_TABLES)!;
    expect(() => new Bun.Transpiler({ loader: "ts" }).transformSync(out)).not.toThrow();
  });
});

describe("lambdaEntry", () => {
  test("hands each request to the app's fetch and exports a streaming handler", () => {
    const entry = lambdaEntry();
    expect(entry).toContain("import { streamHandle } from 'hono/aws-lambda'");
    expect(entry).toContain("import server from './index'");
    expect(entry).toContain("server.fetch(c.req.raw)");
    expect(entry).toContain("export const handler = streamHandle(app)");
    expect(() => new Bun.Transpiler({ loader: "ts" }).transformSync(entry)).not.toThrow();
  });
});

describe("schemaHash", () => {
  const BASE = "CREATE TABLE IF NOT EXISTS items (id SERIAL PRIMARY KEY, title TEXT NOT NULL);";

  test("is a hex sha-256", () => {
    expect(schemaHash(BASE)).toMatch(/^[0-9a-f]{64}$/);
  });

  test("ignores whitespace, line breaks and indentation", () => {
    const spaced = `
      CREATE TABLE IF NOT EXISTS items (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL
      );
    `;
    expect(schemaHash(spaced)).toBe(schemaHash(BASE));
    expect(schemaHash(BASE.replace(/ /g, "   "))).toBe(schemaHash(BASE));
  });

  test("ignores comments", () => {
    const commented = `-- the items table\nCREATE TABLE IF NOT EXISTS items ( /* key */ id SERIAL PRIMARY KEY, title TEXT NOT NULL ); -- end`;
    expect(schemaHash(commented)).toBe(schemaHash(BASE));
  });

  test("the trailing semicolon does not count", () => {
    expect(schemaHash(BASE.slice(0, -1))).toBe(schemaHash(BASE));
  });

  test("changes on any statement change", () => {
    const base = schemaHash(BASE);
    for (const changed of [
      BASE.replace("title", "name"),
      BASE.replace("NOT NULL", "NULL"),
      BASE.replace("SERIAL", "BIGSERIAL"),
      BASE.replace("items", "item"),
      `${BASE}\nALTER TABLE items ADD COLUMN IF NOT EXISTS x INT;`,
      BASE.replace("IF NOT EXISTS ", ""),
    ]) {
      expect(schemaHash(changed)).not.toBe(base);
    }
  });

  test("the order of statements matters", () => {
    expect(schemaHash("A; B;")).not.toBe(schemaHash("B; A;"));
  });

  // A default of 'a  b' is not a default of 'a b'; and '--' inside a string is data.
  test("whitespace and comment markers inside a string literal count", () => {
    const one = "CREATE TABLE t (c TEXT DEFAULT 'a b');";
    expect(schemaHash("CREATE TABLE t (c TEXT DEFAULT 'a  b');")).not.toBe(schemaHash(one));
    expect(schemaHash("CREATE TABLE t (c TEXT DEFAULT 'a--b');")).not.toBe(schemaHash("CREATE TABLE t (c TEXT DEFAULT 'a');"));
  });

  test("the scaffold hashes the same however the template is indented", () => {
    const sql = extractInitSql(DB_CLIENT_TS)!;
    expect(schemaHash(sql)).toBe(schemaHash(sql.replace(/\n\s+/g, " ")));
  });
});
