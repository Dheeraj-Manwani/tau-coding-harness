import { describe, expect, mock, test } from "bun:test";

// `filterPushableFiles` reads the project's `.gitignore` body out of R2. Stub
// the blob store so these stay pure unit tests — what's under test is the
// filtering decision, not object storage.
let gitignoreBody = "";
let getBlobTextCalls = 0;

// Override only getBlobText — the rest of the module (putBlob, blobKey, …) is
// still needed by github.ts's transitive imports.
const realS3 = await import("@/lib/s3");
mock.module("@/lib/s3", () => ({
  ...realS3,
  getBlobText: async () => {
    getBlobTextCalls += 1;
    if (gitignoreBody === "__throw__") throw new Error("blob missing");
    return gitignoreBody;
  },
}));

const { filterPushableFiles } = await import("@/api/lib/github");

/** Terse fixture: a path becomes a {path, contentHash} row. */
const files = (...paths: string[]) =>
  paths.map((path) => ({ path, contentHash: `hash-${path}` }));

const pathsOf = async (
  rows: { path: string; contentHash: string }[],
): Promise<string[]> =>
  (await filterPushableFiles("u1", "p1", rows)).map((f) => f.path);

describe("filterPushableFiles", () => {
  test("drops credential-shaped paths even with no .gitignore", async () => {
    gitignoreBody = "";
    const kept = await pathsOf(
      files("src/App.tsx", ".env", "server/.env.local", "certs/key.pem"),
    );

    expect(kept).toEqual(["src/App.tsx"]);
    // No .gitignore row to read.
    expect(getBlobTextCalls).toBe(0);
  });

  test("the secret floor wins even when .gitignore would allow the file", async () => {
    // The regression that motivated all of this: a project whose .gitignore was
    // deleted or rewritten must still not be able to publish keys.
    gitignoreBody = "!.env\n";
    const kept = await pathsOf(files(".gitignore", "src/App.tsx", ".env"));

    expect(kept).not.toContain(".env");
    expect(kept).toContain("src/App.tsx");
  });

  test("honors the project's .gitignore", async () => {
    gitignoreBody = "node_modules\ndist\ndata/\n*.log\n";
    const kept = await pathsOf(
      files(
        ".gitignore",
        "src/App.tsx",
        "dist/index.js",
        "data/pgdata/base.db",
        "debug.log",
        "node_modules/react/index.js",
      ),
    );

    expect(kept).toEqual([".gitignore", "src/App.tsx"]);
  });

  test("commits .gitignore itself", async () => {
    // git only ignores untracked files; .gitignore is always tracked. A pattern
    // that matches it must not remove it from the commit.
    gitignoreBody = ".gitignore\n";
    const kept = await pathsOf(files(".gitignore", "src/App.tsx"));

    expect(kept).toContain(".gitignore");
  });

  test("a missing .gitignore blob degrades to the secret floor, not to 'push everything'", async () => {
    gitignoreBody = "__throw__";
    const kept = await pathsOf(files(".gitignore", "src/App.tsx", ".env"));

    // Over-including build output is a cosmetic problem; publishing a key is not.
    expect(kept).not.toContain(".env");
    expect(kept).toContain("src/App.tsx");
  });

  test("passes ordinary projects through untouched", async () => {
    gitignoreBody = "node_modules\ndist\n";
    const input = files(
      ".gitignore",
      "index.html",
      "package.json",
      "src/App.tsx",
      "src/main.tsx",
      "server/index.ts",
      ".tau/CONTEXT.md",
    );

    expect(await pathsOf(input)).toEqual(input.map((f) => f.path));
  });
});
