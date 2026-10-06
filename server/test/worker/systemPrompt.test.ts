import { describe, expect, test } from "bun:test";
import { buildSystemPrompt } from "@/worker/agent/config";
import { DOC_NAMES, readDoc } from "@/worker/agent/docs";
import {
  BASE_APP_TOOLS,
  PROVISION_SANDBOX_BASE_TOOL,
  TOOL_DEFINITIONS,
} from "@/worker/agent/tools/tools";
import { BASE_TEMPLATE_KEY } from "@/worker/templates/registry";

// A generation-2 project (the `tau-app-v2` base image) gets its own stack
// section; generation-1 projects must keep getting exactly the prompt they had.
// See doc/CONTEXT_AND_MEMORY_PLAN.md §6.

describe("system prompt — generation 1", () => {
  test("an unselected project is shown the stack chooser", () => {
    const prompt = buildSystemPrompt({ templateKey: "fullstack", selected: false });
    expect(prompt).toContain("## Choosing your stack");
    expect(prompt).toContain("`fullstack-db`");
  });

  test("a selected project is told about the template manifest in CONTEXT.md", () => {
    const prompt = buildSystemPrompt({ templateKey: "fullstack", selected: true });
    expect(prompt).not.toContain("## Choosing your stack");
    expect(prompt).toContain("Spotify-inspired");
    expect(prompt).toContain("DYNAMIC");
    expect(prompt).toContain("## AI features in the app you build");
    expect(prompt).toContain("## API keys for other services");
  });

  test("is never told about the in-place setup tools it does not have", () => {
    for (const key of ["frontend", "fullstack", "fullstack-db"] as const) {
      for (const selected of [false, true]) {
        const prompt = buildSystemPrompt({ templateKey: key, selected });
        expect(prompt).not.toContain("add_backend");
        expect(prompt).not.toContain("add_database");
      }
    }
  });
});

describe("system prompt — generation 2, every level", () => {
  const levels = ["v2-frontend", "v2-fullstack", "v2-fullstack-db"] as const;

  test("never shows the stack chooser — there is nothing to choose", () => {
    for (const key of levels) {
      const prompt = buildSystemPrompt({ templateKey: key, selected: false });
      expect(prompt).not.toContain("## Choosing your stack");
      expect(prompt).toContain("`provision_sandbox` takes no arguments");
    }
  });

  test("is the same before and after the sandbox is provisioned", () => {
    // Generation 1's prompt changes between a project's first run and its
    // second, which rewrites the start of the conversation the model provider
    // has cached. One base image means there is nothing left to change.
    for (const key of levels) {
      expect(buildSystemPrompt({ templateKey: key, selected: false })).toBe(
        buildSystemPrompt({ templateKey: key, selected: true }),
      );
    }
  });

  test("describes a neutral theme and CONTEXT.md as app memory", () => {
    for (const key of levels) {
      const prompt = buildSystemPrompt({ templateKey: key });
      expect(prompt).not.toContain("Spotify");
      expect(prompt).not.toContain("#1DB954");
      expect(prompt).not.toContain("DYNAMIC");
      expect(prompt).not.toContain("STATIC");
      expect(prompt).toContain("this app's memory");
    }
  });

  test("says when to call enable_ai but leaves the recipe to the tool", () => {
    // `enable_ai` returns the endpoint, headers and body when it is called, so
    // the prompt does not carry them on every turn of every app.
    for (const key of levels) {
      const prompt = buildSystemPrompt({ templateKey: key });
      expect(prompt).toContain("## AI features in the app you build");
      expect(prompt).toContain("Call `enable_ai`");
      expect(prompt).toContain("## API keys for other services");
      expect(prompt).not.toContain("X-Tau-Project");
      // The reprovision round trip is a generation-1 mechanism.
      expect(prompt).not.toContain("needsReprovision");
    }
  });

  test("still carries the effort directive and the shared rules", () => {
    const max = buildSystemPrompt({ templateKey: BASE_TEMPLATE_KEY, effort: "MAX" });
    expect(max).toContain("## Effort: MAX");
    expect(max).toContain("## Sub-agents");
    expect(max).toContain("## Final message");
  });
});

describe("system prompt — generation 2, by level", () => {
  const frontend = buildSystemPrompt({ templateKey: "v2-frontend" });
  const fullstack = buildSystemPrompt({ templateKey: "v2-fullstack" });
  const withDb = buildSystemPrompt({ templateKey: "v2-fullstack-db" });

  test("frontend: a backend is a tool call away, not unavailable", () => {
    expect(frontend).toContain("Frontend only so far");
    expect(frontend).toContain("`add_backend`");
    expect(frontend).toContain("`add_database`");
    expect(frontend).toContain("Tier 3 — Server API + Database (added on demand)");
    // No server yet, so no claim that one is listening.
    expect(frontend).not.toContain("hono backend (if present)");
  });

  test("with a backend: the API rules appear, and the database is still on demand", () => {
    expect(fullstack).toContain("API in `server/index.ts`, port 3000");
    expect(fullstack).toContain("**No database yet**");
    expect(fullstack).toContain("Do NOT create a second Hono instance");
    expect(fullstack).toContain("Tier 3 — Server API (set up) + Database (on demand)");
    expect(fullstack).not.toContain("server/db/schema.ts");
  });

  test("with a database: says it is set up, so it is not scaffolded twice", () => {
    expect(withDb).toContain("already set up and wired");
    expect(withDb).toContain("server/db/schema.ts");
    expect(withDb).toContain("Tier 3 — Server API + Database (already set up)");
    expect(withDb).not.toContain("**No database yet**");
  });

  test("the three levels differ only where the stack does", () => {
    // The rest of the prompt must not move when a backend is added, or adding
    // one would invalidate more of the provider's cache than it has to.
    const tail = (p: string) => p.slice(p.indexOf("## Already provided"), p.indexOf("## Implementation complexity"));
    expect(tail(frontend)).toBe(tail(fullstack));
    expect(tail(fullstack)).toBe(tail(withDb));
  });
});

describe("tools for generation 2", () => {
  test("provision_sandbox keeps its name, so the executor is unaffected", () => {
    const legacy = TOOL_DEFINITIONS.find(
      (t) => t.function.name === "provision_sandbox",
    );
    expect(legacy).toBeDefined();
    expect(PROVISION_SANDBOX_BASE_TOOL.function.name).toBe("provision_sandbox");
  });

  test("provision_sandbox offers no template to pick", () => {
    expect(PROVISION_SANDBOX_BASE_TOOL.function.parameters.properties).toEqual({});
  });

  test("the setup tools exist only outside the generation-1 list", () => {
    const names = BASE_APP_TOOLS.map((t) => t.function.name);
    expect(names).toEqual(["add_backend", "add_database"]);
    const legacyNames = TOOL_DEFINITIONS.map((t) => t.function.name) as string[];
    for (const name of names) expect(legacyNames).not.toContain(name);
  });
});

describe("guides", () => {
  test("every guide loads and is a real document", () => {
    for (const name of DOC_NAMES) {
      const doc = readDoc(name);
      expect(doc.startsWith("# ")).toBe(true);
      expect(doc.length).toBeGreaterThan(500);
    }
  });

  test("the backend guide carries the rules that break an app when missed", () => {
    const doc = readDoc("backend");
    expect(doc).toContain("/api/health");
    expect(doc).toContain("app.listen");
    expect(doc).toContain("never `localhost:3000`");
    expect(doc).toContain(".tau/logs/server.log");
  });

  test("the database guide says where a table has to be declared", () => {
    const doc = readDoc("database");
    expect(doc).toContain("server/db/schema.ts");
    expect(doc).toContain("initDb()");
    expect(doc).toContain("CREATE TABLE IF NOT EXISTS");
    expect(doc).toContain("Do NOT use sqlite");
  });
});
