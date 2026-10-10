import { expect, test } from "bun:test";
import { maskConnectionStrings } from "@/lib/appLogs";

test("a database connection string in a log line is masked", () => {
  const line = 'error connecting to postgresql://neondb_owner:s3cret@ep-x-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require, retrying';
  const out = maskConnectionStrings(line);
  expect(out).not.toContain("s3cret");
  expect(out).toContain("postgres://***redacted***");
  expect(out).toContain("retrying");
});

test("lines without a connection string are unchanged", () => {
  expect(maskConnectionStrings("GET /api/health 200")).toBe("GET /api/health 200");
});
