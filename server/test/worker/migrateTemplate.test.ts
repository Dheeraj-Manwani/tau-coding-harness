import { describe, expect, test } from "bun:test";
import {
  patchContextMd,
  patchPackageJson,
  patchViteConfig,
} from "@/worker/lib/migrateTemplate.ts";
import {
  HONO_SERVER_INDEX,
  writeViteConfigContent,
} from "@/worker/templates/shared.ts";

// `frontend` → `fullstack` is a deterministic transform over the manifest, not a
// rewrite: only four things differ between the two templates and all four are
// mechanical. These cover the three that involve editing an existing file — the
// fourth (server/index.ts) is a straight write of a shared constant.
//
// Background: doc/AI_FOR_GENERATED_APPS.md §7.3.

describe("patchViteConfig", () => {
  const original = writeViteConfigContent({ proxyApi: false });

  test("inserts the proxy after the allowedHosts anchor", () => {
    const out = patchViteConfig(original);
    expect(out).not.toBeNull();
    expect(out).toContain("proxy: { '/api': 'http://localhost:3000' }");
    // The result must be exactly the server-flavoured template, or the migrated
    // project has a config subtly unlike a natively-provisioned one.
    expect(out).toBe(writeViteConfigContent({ proxyApi: true }));
  });

  test("is idempotent — a second migration must not double the proxy", () => {
    const once = patchViteConfig(original)!;
    expect(patchViteConfig(once)).toBe(once);
  });

  test("preserves everything else in the file", () => {
    const out = patchViteConfig(original)!;
    expect(out).toContain("allowedHosts: ['.e2b.app']");
    expect(out).toContain("@tailwindcss/vite");
    expect(out).toContain("port: 5173");
  });

  test("returns null when the anchor is gone, rather than guessing", () => {
    // The agent rewrote the file. A blind regex here would be worse than an
    // honest "regenerate and tell them" — we cannot know what else changed.
    const rewritten = "export default { plugins: [] }\n";
    expect(patchViteConfig(rewritten)).toBeNull();
  });
});

describe("patchPackageJson", () => {
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

  test("adds hono to dependencies", () => {
    const out = patchPackageJson(pkg)!;
    expect(JSON.parse(out).dependencies.hono).toBeDefined();
  });

  test("keeps every other field and section intact", () => {
    const parsed = JSON.parse(patchPackageJson(pkg)!);
    expect(parsed.name).toBe("app");
    expect(parsed.private).toBe(true);
    expect(parsed.scripts.build).toBe("tsc -b && vite build");
    expect(parsed.dependencies.react).toBe("^19.0.0");
    expect(parsed.devDependencies.vite).toBe("^6.0.0");
  });

  test("is idempotent", () => {
    const once = patchPackageJson(pkg)!;
    expect(patchPackageJson(once)).toBe(once);
  });

  test("returns null on unparseable json rather than destroying the file", () => {
    expect(patchPackageJson("{ not json")).toBeNull();
  });

  test("handles a package.json with no dependencies block", () => {
    const out = patchPackageJson('{\n  "name": "app"\n}')!;
    expect(JSON.parse(out).dependencies.hono).toBeDefined();
  });
});

describe("patchContextMd", () => {
  test("regenerates the static half and keeps the agent's half verbatim", () => {
    // The DYNAMIC marker exists for exactly this surgery: everything below it is
    // what the agent has learned about the app and must survive untouched.
    const stale = [
      "# Some old frontend-only manifest",
      "- Stack: Vite + React. **Frontend only.**",
      "<!-- ===================================================================== -->",
      "<!-- DYNAMIC — tau maintains everything below. Update after each change.    -->",
      "<!-- ===================================================================== -->",
      "",
      "## Current app",
      "A todo list with localStorage persistence. Routes: / and /archive.",
      "",
    ].join("\n");

    const out = patchContextMd(stale);

    expect(out).toContain("A todo list with localStorage persistence");
    expect(out).toContain("Routes: / and /archive");
    expect(out).not.toContain("Some old frontend-only manifest");
    expect(out).not.toContain("**Frontend only.**");
    // The new static half must describe a server, since that is what changed.
    expect(out).toContain("server/index.ts");
  });

  test("falls back to a fresh file when there is no marker", () => {
    const out = patchContextMd("garbage with no marker at all");
    expect(out).not.toContain("garbage");
    expect(out).toContain("server/index.ts");
  });

  test("falls back to a fresh file when CONTEXT.md is missing entirely", () => {
    expect(patchContextMd(null)).toContain("server/index.ts");
  });

  test("keeps exactly one DYNAMIC marker", () => {
    const stale =
      "old\n<!-- DYNAMIC — tau maintains everything below.    -->\n## Current app\nstuff\n";
    const out = patchContextMd(stale);
    expect(out.match(/<!-- DYNAMIC/g)).toHaveLength(1);
  });
});

describe("HONO_SERVER_INDEX", () => {
  test("is the real server the template bakes in", () => {
    // Shared with writeHonoApi so the migrated app and a natively-provisioned
    // one cannot drift.
    expect(HONO_SERVER_INDEX).toContain("import { Hono } from 'hono'");
    expect(HONO_SERVER_INDEX).toContain("/api/health");
    expect(HONO_SERVER_INDEX).toContain(
      "export default { port: 3000, fetch: app.fetch }",
    );
  });
});
