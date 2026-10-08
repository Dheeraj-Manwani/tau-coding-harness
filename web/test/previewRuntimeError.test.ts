import { describe, expect, test } from "bun:test";
import { parseRuntimeError } from "../src/features/project/previewRuntimeError";

// What a preview says went wrong in it, on its way into a prompt. The frame it
// comes from also runs the generated app, which can post anything it likes, so
// only what the API would accept is let through.
describe("errors a preview reports about itself", () => {
  const crash = {
    kind: "error",
    message: "Uncaught TypeError: Cannot read properties of undefined (reading 'map')",
    stack: "TypeError: Cannot read properties of undefined (reading 'map')\n    at Home (/src/pages/Home.tsx:42:18)",
    at: "/src/pages/Home.tsx:42:18",
    count: 1,
  };

  test("are passed on as the API takes them", () => {
    expect(parseRuntimeError({ source: "tau-preview-health", type: "errors", path: "/menu?tab=2", errors: [crash] })).toEqual({
      path: "/menu?tab=2",
      errors: [
        {
          kind: "error",
          message: crash.message,
          stack: crash.stack,
          at: crash.at,
        },
      ],
    });
  });

  test("keep a count only when the fault repeated", () => {
    const parsed = parseRuntimeError({ errors: [{ ...crash, count: 7 }] });
    expect(parsed?.errors[0]?.count).toBe(7);
    expect(parseRuntimeError({ errors: [{ ...crash, count: 1.5 }] })?.errors[0]).not.toHaveProperty("count");
  });

  test("lose anything that is not one of the three kinds, or says nothing", () => {
    expect(
      parseRuntimeError({
        errors: [
          { kind: "warning", message: "not an error" },
          { kind: "error", message: "   " },
          { kind: "error" },
          "boom",
          null,
          { kind: "rejection", message: "Failed to fetch" },
        ],
      }),
    ).toEqual({ errors: [{ kind: "rejection", message: "Failed to fetch" }] });
  });

  test("are cut to the API's limits rather than sent on to be refused", () => {
    const parsed = parseRuntimeError({
      path: `/${"p".repeat(2_000)}`,
      errors: Array.from({ length: 12 }, () => ({
        kind: "error",
        message: "m".repeat(5_000),
        stack: "s".repeat(20_000),
        at: "a".repeat(2_000),
      })),
    })!;
    expect(parsed.errors).toHaveLength(5);
    expect(parsed.errors[0]!.message).toHaveLength(1000);
    expect(parsed.errors[0]!.stack).toHaveLength(4000);
    expect(parsed.errors[0]!.at).toHaveLength(500);
    expect(parsed.path).toHaveLength(500);
  });

  test("a route that is not a path is dropped, the errors kept", () => {
    expect(parseRuntimeError({ path: "https://elsewhere.example/x", errors: [crash] })).not.toHaveProperty("path");
    expect(parseRuntimeError({ path: 42, errors: [crash] })).not.toHaveProperty("path");
  });

  test("a message with no usable errors is nothing to send", () => {
    expect(parseRuntimeError(null)).toBeNull();
    expect(parseRuntimeError("errors")).toBeNull();
    expect(parseRuntimeError({ errors: "many" })).toBeNull();
    expect(parseRuntimeError({ errors: [] })).toBeNull();
    expect(parseRuntimeError({ errors: [{ kind: "nope", message: "x" }] })).toBeNull();
  });
});
