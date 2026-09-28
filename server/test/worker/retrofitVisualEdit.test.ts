import { describe, expect, test } from "bun:test";
import {
  patchPackageJsonForVisualEdit,
  patchViteConfigForVisualEdit,
} from "@/worker/lib/retrofitVisualEdit.ts";
import {
  VISUAL_EDIT_DEPS,
  VISUAL_EDIT_DEPS_ARGS,
  VISUAL_EDIT_IMPORT_LINE,
  writeViteConfigContent,
} from "@/worker/templates/shared.ts";

// Phase 5 of doc/archive/VISUAL_EDIT_PLAN.md: projects created before the tagger shipped
// have a vite.config.ts that never loads it. Retrofitting them is a deterministic
// edit over the manifest, and these cover the two files it rewrites.
//
// The stakes are lopsided: getting this right buys click-to-edit on an old
// project, getting it wrong writes a vite.config.ts that doesn't parse and takes
// the user's preview down. So the failure mode throughout is "decline to patch",
// never "guess".

/** What an old project's config looked like: the current template minus the two
 *  visual-edit lines. Derived from the real generator so it can't drift. */
function preVisualEditConfig(opts: { proxyApi: boolean }): string {
  return writeViteConfigContent(opts)
    .replace(`${VISUAL_EDIT_IMPORT_LINE}\n`, "")
    .replace(", tauTagger()]", "]");
}

describe("patchViteConfigForVisualEdit", () => {
  test("the fixture really is a config without visual edit", () => {
    const old = preVisualEditConfig({ proxyApi: false });
    expect(old).not.toContain("tauTagger");
    expect(old).toContain("plugins: [react(), tailwindcss()]");
  });

  test("a retrofitted config is byte-identical to a fresh one", () => {
    // The whole point of anchoring on the template's own strings. If a retrofit
    // produced a merely-equivalent config, every later patch would have to cope
    // with two shapes instead of one.
    for (const proxyApi of [false, true]) {
      const out = patchViteConfigForVisualEdit(
        preVisualEditConfig({ proxyApi }),
      );
      expect(out).toBe(writeViteConfigContent({ proxyApi }));
    }
  });

  test("is idempotent — a second provision must not double the plugin", () => {
    const once = patchViteConfigForVisualEdit(
      preVisualEditConfig({ proxyApi: false }),
    )!;
    expect(patchViteConfigForVisualEdit(once)).toBe(once);
    expect(once.match(/tauTagger\(\)/g)).toHaveLength(1);
    expect(once.match(/tagger\.js/g)).toHaveLength(1);
  });

  test("preserves settings the agent added", () => {
    const custom = preVisualEditConfig({ proxyApi: false }).replace(
      "  resolve:",
      "  define: { __BUILD__: JSON.stringify('x') },\n  resolve:",
    );
    const out = patchViteConfigForVisualEdit(custom)!;
    expect(out).toContain("__BUILD__");
    expect(out).toContain("allowedHosts: ['.e2b.app']");
    expect(out).toContain("tauTagger()");
  });

  test("handles a rewritten config by inserting at the front of the array", () => {
    // No template anchors left. Position doesn't matter — `enforce: 'pre'` is
    // what orders the plugin ahead of React (Phase 0 proved that by listing it
    // last) — so we insert where we can do it without bracket matching.
    const rewritten = [
      "import { defineConfig } from 'vite'",
      "import react from '@vitejs/plugin-react'",
      "",
      "export default defineConfig({",
      "  plugins: [react({ babel: { plugins: [['x', {}]] } })],",
      "})",
      "",
    ].join("\n");

    const out = patchViteConfigForVisualEdit(rewritten)!;
    expect(out).toContain(
      "plugins: [tauTagger(), react({ babel: { plugins: [['x', {}]] } })]",
    );
    expect(out.startsWith(VISUAL_EDIT_IMPORT_LINE)).toBe(true);
    // The nested plugins array must come through untouched.
    expect(out.match(/tauTagger\(\)/g)).toHaveLength(1);
  });

  test("does not insert into a multi-line import", () => {
    // "after the last import line" would land between `import {` and its `}`
    // and produce a file that doesn't parse. Hence: top of file.
    const multiline = [
      "import {",
      "  defineConfig,",
      "} from 'vite'",
      "export default defineConfig({ plugins: [] })",
      "",
    ].join("\n");

    const out = patchViteConfigForVisualEdit(multiline)!;
    expect(out).toBe(
      `${VISUAL_EDIT_IMPORT_LINE}\n${multiline.replace(
        "plugins: []",
        "plugins: [tauTagger()]",
      )}`,
    );
  });

  test("an empty plugins array gets no stray comma", () => {
    const out = patchViteConfigForVisualEdit(
      "import x from 'vite'\nexport default { plugins: [ ] }\n",
    )!;
    expect(out).toContain("plugins: [tauTagger() ]");
  });

  test("re-adds only the missing half when the agent deleted one", () => {
    const full = writeViteConfigContent({ proxyApi: false });

    const importDropped = full.replace(`${VISUAL_EDIT_IMPORT_LINE}\n`, "");
    expect(patchViteConfigForVisualEdit(importDropped)).toBe(full);

    const pluginDropped = full.replace(", tauTagger()]", "]");
    expect(patchViteConfigForVisualEdit(pluginDropped)).toBe(full);
  });

  test("returns null when there is no plugins array, rather than guessing", () => {
    // Regenerating from the template here (what migrateTemplate does) would
    // silently discard whatever the agent built, and nobody asked for a retrofit.
    expect(patchViteConfigForVisualEdit("export default {}\n")).toBeNull();
  });
});

describe("patchPackageJsonForVisualEdit", () => {
  const pkg = JSON.stringify(
    {
      name: "app",
      private: true,
      scripts: { dev: "vite", build: "tsc -b && vite build" },
      dependencies: { react: "^19.0.0", "react-dom": "^19.0.0" },
      devDependencies: { vite: "^6.0.0" },
    },
    null,
    2,
  );

  test("adds both tagger devDependencies", () => {
    const dev = JSON.parse(patchPackageJsonForVisualEdit(pkg)!).devDependencies;
    for (const [name, range] of Object.entries(VISUAL_EDIT_DEPS)) {
      expect(dev[name]).toBe(range);
    }
  });

  test("declares the same versions the template installs", () => {
    // The retrofit writes package.json directly; the template shells out to
    // `bun add -d`. If these two ever disagree, a retrofitted project resolves a
    // different tagger toolchain than a fresh one and the divergence is invisible
    // until something breaks in only one of them.
    for (const [name, range] of Object.entries(VISUAL_EDIT_DEPS)) {
      expect(VISUAL_EDIT_DEPS_ARGS).toContain(`${name}@${range}`);
    }
  });

  test("keeps every other field and section intact", () => {
    const parsed = JSON.parse(patchPackageJsonForVisualEdit(pkg)!);
    expect(parsed.name).toBe("app");
    expect(parsed.private).toBe(true);
    expect(parsed.scripts.build).toBe("tsc -b && vite build");
    expect(parsed.dependencies.react).toBe("^19.0.0");
    expect(parsed.devDependencies.vite).toBe("^6.0.0");
  });

  test("is idempotent", () => {
    const once = patchPackageJsonForVisualEdit(pkg)!;
    expect(patchPackageJsonForVisualEdit(once)).toBe(once);
  });

  test("does not downgrade a version the user pinned themselves", () => {
    const pinned = JSON.stringify(
      { name: "app", devDependencies: { "magic-string": "0.29.0" } },
      null,
      2,
    );
    const out = JSON.parse(patchPackageJsonForVisualEdit(pinned)!);
    expect(out.devDependencies["magic-string"]).toBe("0.29.0");
    expect(out.devDependencies["@babel/parser"]).toBeDefined();
  });

  test("handles a package.json with no devDependencies block", () => {
    const out = JSON.parse(
      patchPackageJsonForVisualEdit('{\n  "name": "app"\n}')!,
    );
    expect(Object.keys(out.devDependencies).sort()).toEqual(
      Object.keys(VISUAL_EDIT_DEPS).sort(),
    );
  });

  test("returns null on unparseable json rather than destroying the file", () => {
    // The caller treats this as "skip the whole retrofit": wiring the plugin
    // without a way to install its deps is how you brick an export.
    expect(patchPackageJsonForVisualEdit("{ not json")).toBeNull();
  });
});
