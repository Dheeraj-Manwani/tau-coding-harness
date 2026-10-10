import { describe, expect, test } from "bun:test";
import { diffSchema, needsConfirmation, statementsOf } from "@/worker/lib/schemaChange";

const base = `
CREATE TABLE IF NOT EXISTS items (
  id serial PRIMARY KEY,
  title text NOT NULL,
  done boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS items_title_idx ON items (title);
`;

describe("diffSchema", () => {
  test("the same SQL, reformatted and commented, is no change", () => {
    const again = base.replace(/\n/g, "\n  ").replace("title text", "title   text -- the title\n");
    const d = diffSchema(base, again);
    expect(d).toEqual({ additive: [], changes: [] });
  });

  test("a new table is the app's own SQL's to create", () => {
    const d = diffSchema(base, base + "CREATE TABLE IF NOT EXISTS tags (id serial PRIMARY KEY, name text NOT NULL);");
    expect(d).toEqual({ additive: [], changes: [] });
  });

  test("a new nullable column on an existing table becomes an ALTER tau adds itself", () => {
    const d = diffSchema(base, base.replace("done boolean", "notes text,\n  done boolean"));
    expect(d.changes).toEqual([]);
    expect(d.additive).toEqual([`ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "notes" text;`]);
  });

  test("a new required column with a default is additive; without one it needs confirmation", () => {
    const withDefault = diffSchema(base, base.replace("done boolean", "priority integer NOT NULL DEFAULT 0,\n  done boolean"));
    expect(withDefault.changes).toEqual([]);
    expect(withDefault.additive[0]).toContain(`ADD COLUMN IF NOT EXISTS "priority" integer NOT NULL DEFAULT 0`);

    const without = diffSchema(base, base.replace("done boolean", "priority integer NOT NULL,\n  done boolean"));
    expect(without.changes.map((c) => c.kind)).toEqual(["required_column"]);
    expect(without.additive).toEqual([]);
    expect(needsConfirmation(without)).toBe(true);
  });

  test("a removed column, a retyped column and a removed table all need confirmation", () => {
    expect(diffSchema(base, base.replace("  title text NOT NULL,\n", "")).changes.map((c) => c.kind)).toEqual(["drop_column"]);
    expect(diffSchema(base, base.replace("title text", "title varchar(80)")).changes.map((c) => c.kind)).toEqual(["type_change"]);
    expect(diffSchema(base, "CREATE TABLE IF NOT EXISTS other (id serial PRIMARY KEY);").changes.map((c) => c.kind).sort()).toEqual(["drop_table"]);
  });

  test("a rename is a removed column and a new one, so it stops for confirmation", () => {
    const d = diffSchema(base, base.replace("title text NOT NULL", "name text NOT NULL"));
    expect(d.changes.map((c) => c.kind).sort()).toEqual(["drop_column", "required_column"]);
  });

  test("a changed default or nullability is flagged, not silently ignored", () => {
    const d = diffSchema(base, base.replace("done boolean NOT NULL DEFAULT false", "done boolean NOT NULL DEFAULT true"));
    expect(d.changes.map((c) => c.kind)).toEqual(["column_modified"]);
  });

  test("quoted names, public. prefixes and constraints inside the table are read", () => {
    const a = `CREATE TABLE IF NOT EXISTS public."Items" (id serial, name text, PRIMARY KEY (id), UNIQUE (name));`;
    const b = `CREATE TABLE IF NOT EXISTS "items" (id serial, name text, extra jsonb, PRIMARY KEY (id), UNIQUE (name));`;
    const d = diffSchema(a, b);
    expect(d.changes).toEqual([]);
    expect(d.additive).toEqual([`ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "extra" jsonb;`]);
  });

  test("a semicolon or comma inside a string or a default does not break the reading", () => {
    const a = `CREATE TABLE IF NOT EXISTS t (id serial PRIMARY KEY, note text DEFAULT 'a;b,c');`;
    const b = `CREATE TABLE IF NOT EXISTS t (id serial PRIMARY KEY, note text DEFAULT 'a;b,c', tag text);`;
    expect(diffSchema(a, b).additive).toEqual([`ALTER TABLE "t" ADD COLUMN IF NOT EXISTS "tag" text;`]);
  });

  test("things tau cannot judge are changes, not guesses", () => {
    expect(diffSchema(base, base + "ALTER TABLE items DROP COLUMN done;").changes.map((c) => c.kind)).toEqual(["other_statement"]);
    expect(diffSchema(base, base.replace("IF NOT EXISTS items", "items")).changes.map((c) => c.kind)).toEqual(["other_statement"]);
    expect(diffSchema(base, base + "CREATE TABLE IF NOT EXISTS weird (id serial, 5 nonsense);").changes.map((c) => c.kind)).toEqual(["other_statement"]);
  });

  test("a new index is fine, and a removed one is not a change", () => {
    expect(diffSchema(base, base + "CREATE INDEX IF NOT EXISTS items_done_idx ON items (done);").changes).toEqual([]);
    expect(diffSchema(base, base.replace(/CREATE INDEX[^;]*;/, "")).changes).toEqual([]);
  });
});

test("statementsOf splits on semicolons outside strings", () => {
  expect(statementsOf("SELECT 'a;b'; -- c\n SELECT 2;")).toEqual(["SELECT 'a;b'", "SELECT 2"]);
});
