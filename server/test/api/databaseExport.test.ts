import { expect, test } from "bun:test";
import { csvValue, missingColumnsSql, toCsv } from "@/lib/databaseExport";

test("CSV values: quoted only when needed, dates ISO, objects JSON, nothing for null", () => {
  expect(csvValue("plain")).toBe("plain");
  expect(csvValue("a,b")).toBe('"a,b"');
  expect(csvValue('say "hi"')).toBe('"say ""hi"""');
  expect(csvValue("two\nlines")).toBe('"two\nlines"');
  expect(csvValue(null)).toBe("");
  expect(csvValue(undefined)).toBe("");
  expect(csvValue(12)).toBe("12");
  expect(csvValue(false)).toBe("false");
  expect(csvValue(new Date("2026-10-10T01:02:03Z"))).toBe("2026-10-10T01:02:03.000Z");
  expect(csvValue({ a: 1, b: "x,y" })).toBe('"{""a"":1,""b"":""x,y""}"');
});

test("a table becomes a header and rows with CRLF line ends", () => {
  expect(toCsv(["id", "title"], [[1, "a"], [2, "b,c"]])).toBe('id,title\r\n1,a\r\n2,"b,c"\r\n');
  expect(toCsv(["id"], [])).toBe("id\r\n");
});

test("columns that hold data but left the schema are added to schema.sql", () => {
  const schema = 'CREATE TABLE IF NOT EXISTS suppliers (\n  id SERIAL PRIMARY KEY,\n  name TEXT NOT NULL\n);';
  const out = missingColumnsSql(schema, [
    { table: "suppliers", column: "name", type: "text" },
    { table: "suppliers", column: "lead_time_days", type: "integer" },
    { table: "orphans", column: "id", type: "integer" },
  ]);
  expect(out).toContain('ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "lead_time_days" integer;');
  expect(out).not.toContain('"name"');
  expect(out).toContain('"orphans"');
  expect(missingColumnsSql(schema, [{ table: "suppliers", column: "id", type: "integer" }])).toBe("");
});
