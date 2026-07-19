import { describe, expect, test } from "bun:test";
import { buildEditDiff, sha256Hex, toWorkdirPath } from "../src/lib/projectFiles.ts";

// The diff is what the model sees when a user hand-edits a file
// (doc/USER_CODE_EDITING.md). It has to convey the change and its intent while
// staying small enough not to fight the context budget.

describe("buildEditDiff", () => {
  test("captures a single-line change with counts", () => {
    const before = "const a = 1;\nconst b = 2;\nconst c = 3;\n";
    const after = "const a = 1;\nconst b = 20;\nconst c = 3;\n";

    const result = buildEditDiff("src/x.ts", before, after);

    expect(result.truncated).toBe(false);
    expect(result.linesAdded).toBe(1);
    expect(result.linesRemoved).toBe(1);
    expect(result.diff).toContain("-const b = 2;");
    expect(result.diff).toContain("+const b = 20;");
    // Unchanged context is kept so the model can locate the change.
    expect(result.diff).toContain("const a = 1;");
  });

  test("strips the ---/+++ file headers", () => {
    const result = buildEditDiff("src/x.ts", "a\n", "b\n");

    expect(result.diff).not.toContain("--- src/x.ts");
    expect(result.diff).not.toContain("+++ src/x.ts");
    expect(result.diff).not.toContain("Index:");
    expect(result.diff.startsWith("@@")).toBe(true);
  });

  test("counts additions and removals independently", () => {
    const before = "keep\nremove me\n";
    const after = "keep\nadded one\nadded two\n";

    const result = buildEditDiff("f.txt", before, after);

    expect(result.linesAdded).toBe(2);
    expect(result.linesRemoved).toBe(1);
  });

  test("truncates a very large diff instead of blowing the context budget", () => {
    const before = Array.from({ length: 500 }, (_, i) => `line ${i}`).join("\n");
    const after = Array.from({ length: 500 }, (_, i) => `CHANGED ${i}`).join("\n");

    const result = buildEditDiff("big.ts", before, after);

    expect(result.truncated).toBe(true);
    expect(result.diff).toContain("… diff truncated …");
    // ~100 lines of diff + the truncation marker — nowhere near the raw 1000.
    expect(result.diff.split("\n").length).toBeLessThan(110);
    // Counts still describe the whole edit, not just the shown slice.
    expect(result.linesAdded).toBe(500);
    expect(result.linesRemoved).toBe(500);
  });

  test("an unchanged file produces an empty diff", () => {
    const same = "same\ncontent\n";
    const result = buildEditDiff("f.txt", same, same);

    expect(result.linesAdded).toBe(0);
    expect(result.linesRemoved).toBe(0);
  });
});

describe("sha256Hex", () => {
  test("is stable and content-addressed", () => {
    // Must agree with the worker's sha256Hex — both key the same R2 blobs.
    expect(sha256Hex("hello")).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
    expect(sha256Hex("hello")).toBe(sha256Hex("hello"));
    expect(sha256Hex("hello")).not.toBe(sha256Hex("hello "));
  });
});

describe("toWorkdirPath", () => {
  // E2B's files.* API resolves relative paths against /home/user, not the app
  // dir — anchoring wrong writes one level above the project.
  test("anchors relative paths under WORK_DIR", () => {
    expect(toWorkdirPath("src/App.tsx")).toBe("/home/user/app/src/App.tsx");
    expect(toWorkdirPath("./src/App.tsx")).toBe("/home/user/app/src/App.tsx");
  });

  test("passes absolute paths through unchanged", () => {
    expect(toWorkdirPath("/home/user/app/src/App.tsx")).toBe(
      "/home/user/app/src/App.tsx",
    );
  });
});
