import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// ── Drift guard for the duplicated api/ ↔ worker-service/ code ────────────────
//
// `api` and `worker-service` each keep their own Prisma schema and their own
// copy of 14 files in `src/lib/`. They are kept in sync **by hand**, and the
// duplication has been growing. This file makes that drift a failing build
// instead of a silent bug.
//
// It deliberately imports nothing from either service — only `node:fs` — so it
// runs from the repo root without either service's `node_modules` installed.
// Run it with `bun run test:drift`.
//
// Three things are checked, in rising order of how much they would hurt:
//
//   1. The two schema.prisma + migrations trees are identical. Diverged
//      migration histories against one live database is the worst failure
//      available here, and the hardest to unwind.
//   2. Files declared `identical` below still match byte-for-byte.
//   3. THE FORWARD GUARD: the set of filenames duplicated across the two lib
//      directories still equals DUPLICATED_LIBS. A 15th duplicated file fails
//      CI the day it is added, rather than being noticed months later.
//
// See doc/SERVICE_MERGE_PLAN.md for the phased plan that deletes all of this.
// As phase 3 merges each file, delete its entry here. When the manifest is
// empty, delete this file.

const ROOT = join(import.meta.dir, "..");
const API = join(ROOT, "api");
const WORKER = join(ROOT, "worker-service");

/**
 * Every filename present in BOTH `api/src/lib/` and `worker-service/src/lib/`.
 *
 * `identical` — the two copies must stay byte-for-byte equal; enforced below.
 * `drift`     — small unintended differences that phase 3 resolves. Not
 *               enforced, because asserting the *current* diff would just
 *               freeze the drift in place.
 * `subset`    — the worker deliberately carries less code. Merging these needs
 *               a design decision per file, not a diff (phase 4).
 *
 * Measurements in the `note` are from 2026-08-01 @ 1733c5e and are there to
 * show the shape of each difference, not to be asserted.
 */
const DUPLICATED_LIBS: Record<
  string,
  { kind: "identical" | "drift" | "subset"; note: string }
> = {
  "pricing.ts": { kind: "identical", note: "82 lines both" },
  "prisma.ts": { kind: "identical", note: "19 lines both" },
  "sequence.ts": { kind: "identical", note: "16 lines both" },

  "bus.ts": { kind: "drift", note: "comment only: ../lib/bus vs @/lib/bus" },
  "log.ts": {
    kind: "drift",
    note: "svc tag differs (legitimate) + a half-copied typo in api's header",
  },
  "redis.ts": {
    kind: "drift",
    note: "worker passes maxRetriesPerRequest:null, api does not — unintended",
  },
  "headSequence.ts": {
    kind: "drift",
    note: "api has a 10-line doc comment the worker copy lost",
  },

  "apiKeys.ts": { kind: "subset", note: "243 vs 249 lines, 6 changed" },
  "deepseek.ts": { kind: "subset", note: "9 vs 19 lines" },
  "kimi.ts": { kind: "subset", note: "6 vs 21 lines" },
  "github.ts": { kind: "subset", note: "1065 vs 1052 lines, 23 changed" },
  "env.ts": { kind: "subset", note: "201 vs 103 lines" },
  "s3.ts": { kind: "subset", note: "249 vs 195 lines" },
  "credits.ts": { kind: "subset", note: "914 vs 543 lines" },
};

/**
 * Read a file for comparison, normalising line endings.
 *
 * `core.autocrlf` is `true` on Windows, so whether a given file sits in the
 * worktree as LF or CRLF depends on whether git has rewritten it since clone —
 * `git checkout -- <file>` converts LF to CRLF, and touching one copy of a pair
 * but not the other is enough to make two semantically identical files differ
 * by one byte per line. That is a checkout artifact, not drift, and failing on
 * it would train everyone to ignore this suite.
 */
function readNormalised(...path: string[]): string {
  return readFileSync(join(...path), "utf8").replaceAll("\r\n", "\n");
}

/** Source files in a service's `src/lib`, excluding colocated tests. */
function libFiles(serviceDir: string): string[] {
  return readdirSync(join(serviceDir, "src", "lib"))
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .sort();
}

/** Every file under `dir`, keyed by its path relative to `dir`. */
function treeOf(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (current: string) => {
    for (const entry of readdirSync(current).sort()) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else out.set(relative(dir, full).replaceAll("\\", "/"), readNormalised(full));
    }
  };
  walk(dir);
  return out;
}

describe("prisma is not allowed to diverge", () => {
  // The two schemas are byte-identical today, so this is a cheap assertion that
  // stays cheap — right up until someone adds the Deployment or ProjectVersion
  // table to one service and not the other, which is exactly the moment it
  // needs to fire. Phase 2 of the merge plan collapses these into one schema
  // and this test becomes obsolete.
  test("schema.prisma is identical in both services", () => {
    const api = readNormalised(API, "prisma", "schema.prisma");
    const worker = readNormalised(WORKER, "prisma", "schema.prisma");
    expect(worker).toBe(api);
  });

  test("the migrations trees are identical in both services", () => {
    const api = treeOf(join(API, "prisma", "migrations"));
    const worker = treeOf(join(WORKER, "prisma", "migrations"));

    // Compare the listings first: a missing or extra migration is a much
    // clearer failure message than a content mismatch on one file.
    expect([...worker.keys()].sort()).toEqual([...api.keys()].sort());

    const differing = [...api.entries()]
      .filter(([path, body]) => worker.get(path) !== body)
      .map(([path]) => path);
    expect(differing).toEqual([]);
  });
});

describe("duplicated lib files", () => {
  // ── The forward guard ──────────────────────────────────────────────────────
  // This is the assertion that earns this file's existence. PLATFORM_COMPARISON
  // §5.6 notes the duplication "grew by several files this month" — invisibly.
  // Now it cannot.
  test("the set of duplicated files matches the manifest", () => {
    const apiLibs = new Set(libFiles(API));
    const duplicated = libFiles(WORKER)
      .filter((f) => apiLibs.has(f))
      .sort();
    const declared = Object.keys(DUPLICATED_LIBS).sort();

    const undeclared = duplicated.filter((f) => !declared.includes(f));
    const resolved = declared.filter((f) => !duplicated.includes(f));

    // A new duplicate: either share it properly, or add it to the manifest
    // with a reason. Do not add it without reading doc/SERVICE_MERGE_PLAN.md.
    expect({ undeclared }).toEqual({ undeclared: [] });

    // One copy is gone — the file was merged or deleted. Good news: drop its
    // entry from the manifest above.
    expect({ resolved }).toEqual({ resolved: [] });
  });

  const identical = Object.entries(DUPLICATED_LIBS).filter(
    ([, meta]) => meta.kind === "identical",
  );

  test.each(identical)("%s is byte-identical in both services", (name) => {
    const api = readNormalised(API, "src", "lib", name);
    const worker = readNormalised(WORKER, "src", "lib", name);
    // If this fails, do not "fix" it by reclassifying the file as `drift` —
    // that is how the original 14 got here. Port the change to both copies, or
    // merge the file for real (phase 3).
    expect(worker).toBe(api);
  });

  test("every manifest entry actually exists in both services", () => {
    // Guards the manifest itself: a typo in a key would otherwise make the
    // byte-identical checks above silently vanish.
    const missing: string[] = [];
    for (const name of Object.keys(DUPLICATED_LIBS)) {
      for (const [label, dir] of [
        ["api", API],
        ["worker-service", WORKER],
      ] as const) {
        try {
          statSync(join(dir, "src", "lib", name));
        } catch {
          missing.push(`${label}/src/lib/${name}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
