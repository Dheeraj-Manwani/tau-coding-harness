import { expect, test } from "bun:test";
import { listProjectsQuerySchema } from "../../src/api/schemas/project.schema";

test("project search trims text and accepts bounded cursor pages", () => {
  expect(listProjectsQuerySchema.parse({ search: "  Portfolio  ", limit: "6" })).toEqual({ search: "Portfolio", limit: 6 });
  expect(listProjectsQuerySchema.parse({}).limit).toBe(20);
});

test("rejects oversized searches, invalid cursors and unbounded page sizes", () => {
  for (const input of [{ search: "x".repeat(201) }, { cursor: "invalid" }, { limit: 1000 }, { limit: 0 }]) {
    expect(listProjectsQuerySchema.safeParse(input).success).toBe(false);
  }
});
