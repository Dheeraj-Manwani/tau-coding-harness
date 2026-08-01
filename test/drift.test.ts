import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// ── Drift guard for the duplicated api ↔ worker code ─────────────────────────
//
// `server/src/api/lib/` and `server/src/worker/lib/` held their own copy of 14
// leaf libs, kept in sync by hand. Thirteen have since been deduped into
// `@/lib/`; the manifest below is what is left. This file fails the build if a
// new duplicate appears or a declared one drifts.
//
// It deliberately imports nothing from the service — only `node:fs` — so it
// runs from the repo root with no `node_modules` installed at all.
// Run it with `bun run test:drift`.
//
// Three things are checked, in rising order of how much they would hurt:
//
//   1. There is exactly ONE prisma schema and ONE generated client. Diverged
//      migration histories against one live database is the worst failure
//      available here, and the hardest to unwind.
//   2. Files declared `identical` below still match byte-for-byte, and shims
//      stay thin.
//   3. THE FORWARD GUARD: the set of filenames duplicated across the two lib
//      directories still equals DUPLICATED_LIBS. A new duplicated file fails CI
//      the day it is added, rather than being noticed months later — and a
//      merged or deleted one fails too, as a reminder to update the manifest.
//
// See doc/SERVICE_MERGE_PLAN.md. As each file is deduped, delete its entry
// here. When the manifest is empty, delete this file.

const ROOT = join(import.meta.dir, "..");
const API = join(ROOT, "server", "src", "api");
const WORKER = join(ROOT, "server", "src", "worker");

/**
 * Every filename present in BOTH `src/api/lib/` and `src/worker/lib/`.
 *
 * `identical` — the two copies must stay byte-for-byte equal; enforced below.
 * `drift`     — small unintended differences. Not enforced, because asserting
 *               the *current* diff would just freeze the drift in place.
 * `subset`    — the worker deliberately carries less code. Merging these needs
 *               a design decision per file, not a diff (phase 4).
 *
 * `shim: true` means the real implementation already moved to `src/lib/` and
 * what remains is a re-export. Those are size-capped below so logic cannot
 * quietly move back in.
 *
 * Measurements in the `note` are from 2026-08-01 and are there to show the
 * shape of each difference, not to be asserted.
 */
const SHIM_MAX_LINES = 12;

const DUPLICATED_LIBS: Record<
  string,
  { kind: "identical" | "drift" | "subset"; note: string; shim?: true }
> = {
  // The last one, and it is deliberate rather than pending. Each copy calls
  // `createLogger()` from @/lib/log with its own service name, so a JSON line
  // still says whether it came from the request path or the job runner. The
  // implementation — all 191 lines of it — lives in @/lib/log.
  "log.ts": {
    kind: "drift",
    shim: true,
    note: "intentional: identical except the svc tag each passes to createLogger()",
  },
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
  return readdirSync(join(serviceDir, "lib"))
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .sort();
}

const SERVER = join(ROOT, "server");

describe("there is exactly one prisma schema and one client", () => {
  // Phase 2 replaced "the two schemas must stay identical" with "a second one
  // must not exist". Phase 5 merged the services, so the two *generated
  // clients* collapsed into one too. The failure guarded against is unchanged
  // and still the worst available here: two migration histories applied to one
  // live database.

  test("the schema and migrations live in server/prisma", () => {
    expect(statSync(join(SERVER, "prisma", "schema.prisma")).isFile()).toBe(
      true,
    );
    expect(statSync(join(SERVER, "prisma", "migrations")).isDirectory()).toBe(
      true,
    );
  });

  test("no stray schema anywhere else in the repo", () => {
    const strays = [
      join(ROOT, "prisma"),
      join(ROOT, "api"),
      join(ROOT, "worker-service"),
      join(API, "prisma"),
      join(WORKER, "prisma"),
    ]
      .filter((dir) => existsSync(dir))
      .map((dir) => relative(ROOT, dir).replaceAll("\\", "/"));
    // A second schema, or a resurrected per-service directory, is how the
    // migration histories would diverge again.
    expect(strays).toEqual([]);
  });

  test("the schema declares exactly one generator, pointing at src/generated", () => {
    const schema = readNormalised(SERVER, "prisma", "schema.prisma");
    const generators = schema.match(/^generator\s+\w+\s*\{/gm) ?? [];
    expect(generators).toHaveLength(1);
    expect(schema).toContain('output   = "../src/generated/prisma"');
  });

  test("nothing imports the generated client by a relative path", () => {
    // Everything goes through the `@/generated/prisma/*` alias. A relative
    // import would still resolve but would reintroduce the depth-sensitivity
    // that made the two-client layout painful to unpick.
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        if (entry === "generated" || entry === "node_modules") continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (entry.endsWith(".ts") || entry.endsWith(".mts")) {
          const body = readNormalised(full);
          if (/from\s+["'][^"']*\.\.?\/[^"']*generated\/prisma/.test(body)) {
            offenders.push(relative(ROOT, full).replaceAll("\\", "/"));
          }
        }
      }
    };
    walk(join(SERVER, "src"));
    walk(join(SERVER, "test"));
    expect(offenders).toEqual([]);
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
    const api = readNormalised(API, "lib", name);
    const worker = readNormalised(WORKER, "lib", name);
    // If this fails, do not "fix" it by reclassifying the file as `drift` —
    // that is how the original 14 got here. Port the change to both copies, or
    // merge the file for real (phase 3).
    expect(worker).toBe(api);
  });

  const shims = Object.entries(DUPLICATED_LIBS).filter(([, m]) => m.shim);

  test.each(shims)("%s is still a thin shim in both services", (name) => {
    // The implementation lives in shared/. If one of these grows back past a
    // re-export, the duplication has quietly returned — which is exactly how
    // these files got to 82 and 191 lines the first time.
    const tooBig = ([["api", API], ["worker-service", WORKER]] as const)
      .map(([label, dir]) => ({
        file: `${label}/lib/${name}`,
        lines: readNormalised(dir, "lib", name).trimEnd().split("\n")
          .length,
      }))
      .filter(({ lines }) => lines > SHIM_MAX_LINES);
    expect(tooBig).toEqual([]);
  });

  test("shims re-export from shared/, and shared/ holds the real code", () => {
    for (const [name] of shims) {
      const body = readNormalised(API, "lib", name);
      expect(body).toContain("@/lib/");
      // The shared module the shim points at must actually exist.
      const sharedFile = join(SERVER, "src", "lib", name);
      expect(existsSync(sharedFile)).toBe(true);
    }
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
          statSync(join(dir, "lib", name));
        } catch {
          missing.push(`${label}/lib/${name}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
