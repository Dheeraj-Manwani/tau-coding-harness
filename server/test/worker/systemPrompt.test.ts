import { describe, expect, test } from "bun:test";
import {
  PREVIEW_PORT,
  buildSystemPrompt,
  effortDirective,
} from "@/worker/agent/config";
import { DOCS, DOC_NAMES, readDoc } from "@/worker/agent/docs";
import {
  BASE_APP_TOOLS,
  PROVISION_SANDBOX_BASE_TOOL,
  TOOL_DEFINITIONS,
} from "@/worker/agent/tools/tools";
import { BASE_TEMPLATE_KEY } from "@/worker/templates/registry";

// A generation-2 project (the `tau-app-v2` base image) gets its own prompt —
// `docs/tau.md`, the rules plus an index of guides; generation-1 projects must
// keep getting exactly the prompt they had.
// See doc/CONTEXT_AND_MEMORY_PLAN.md §3 and §6.

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
      expect(prompt).toContain("`provision_sandbox` creates it: pass a `brief`");
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
      expect(prompt).toContain("call `enable_ai` **before writing any code that talks to a model**");
      expect(prompt).toContain("`request_secret` is the only way to get one");
      expect(prompt).not.toContain("X-Tau-Project");
      expect(prompt).not.toContain("TAU_AI_URL");
      // The reprovision round trip is a generation-1 mechanism.
      expect(prompt).not.toContain("needsReprovision");
    }
  });

  test("keeps the rules that break something before a guide could arrive", () => {
    for (const key of levels) {
      const prompt = buildSystemPrompt({ templateKey: key });
      expect(prompt).toContain("Runtime is **Bun**, not Node");
      expect(prompt).toContain("NEVER start or restart the dev server or the API server");
      expect(prompt).toContain("Never hardcode a key or write one into any file");
      expect(prompt).toContain("never `curl` a file you want to keep");
      expect(prompt).toContain("Never run git commands yourself");
      expect(prompt).toContain("Never a hex value");
      expect(prompt).toContain("Do not add another component library");
    }
  });

  test("lists every guide, with when to read it, and nothing else as a guide", () => {
    for (const key of levels) {
      const prompt = buildSystemPrompt({ templateKey: key });
      const section = prompt.slice(
        prompt.indexOf("## Guides"),
        prompt.indexOf("## What the app can use"),
      );
      const listed = [...section.matchAll(/^- `([a-z-]+)` — /gm)].map((m) => m[1]);
      expect(listed).toEqual([...DOC_NAMES]);
      for (const name of DOC_NAMES) {
        expect(section).toContain(`- \`${name}\` — ${DOCS[name].when}`);
      }
    }
  });

  test("leaves no slot unfilled", () => {
    for (const key of levels) {
      expect(buildSystemPrompt({ templateKey: key })).not.toContain("{{");
      expect(buildSystemPrompt({ templateKey: key, secretNames: ["A"] })).not.toContain("{{");
    }
  });

  test("names the ports the harness actually uses", () => {
    const prompt = buildSystemPrompt({ templateKey: BASE_TEMPLATE_KEY });
    expect(prompt).toContain(`running on port ${PREVIEW_PORT} with hot reload`);
    expect(prompt).toContain(`always runs on port ${PREVIEW_PORT}`);
  });

  test("saved key names come last, so saving a key changes only the end", () => {
    for (const key of levels) {
      const without = buildSystemPrompt({ templateKey: key });
      const withKeys = buildSystemPrompt({
        templateKey: key,
        secretNames: ["STRIPE_SECRET_KEY", "RESEND_API_KEY"],
      });
      expect(withKeys.startsWith(without)).toBe(true);
      // Sorted, so the order the user saved them in does not change the prompt.
      expect(withKeys.slice(without.length)).toContain(
        "`RESEND_API_KEY`, `STRIPE_SECRET_KEY`",
      );
    }
  });

  test("stays within a budget", () => {
    // Everything here is paid for on every turn of every app. A new rule earns
    // its place by replacing one, or by moving detail out to a guide.
    // 19_000 -> 19_500 for file storage: one bullet and one guide-index line,
    // about 320 characters, with the detail in the `storage` guide.
    for (const key of levels) {
      expect(buildSystemPrompt({ templateKey: key }).length).toBeLessThan(19_500);
    }
  });

  test("carries the design core: follow the design, avoid the defaults, write real content", () => {
    for (const key of levels) {
      const prompt = buildSystemPrompt({ templateKey: key });
      const section = prompt.slice(prompt.indexOf("## Design"), prompt.indexOf("## Guides"));
      expect(section).toContain("`.tau/DESIGN.md` is the look");
      expect(section).toContain("`src/index.css` already implements it");
      expect(section).toContain("No centred hero over three equal cards");
      expect(section).toContain("Lorem ipsum");
      expect(section).toContain("One accent");
      // About 400 tokens was the target; allow some room, not a second essay.
      expect(section.length).toBeLessThan(2_900);
      // The look is not described here — that is DESIGN.md's job.
      expect(prompt).not.toContain("neutral grayscale");
    }
  });

  test("still carries the shared rules", () => {
    const prompt = buildSystemPrompt({ templateKey: BASE_TEMPLATE_KEY });
    expect(prompt).toContain("## Sub-agents");
    expect(prompt).toContain("## Final message");
  });
});

describe("effort is not part of the system prompt", () => {
  // Effort is chosen per request. Anything in the system prompt that differs
  // between two requests changes the first tokens of the conversation, and the
  // provider's cache is keyed on exactly those. So the directive rides on the
  // request's own message instead (context/history.ts).
  test("no generation's prompt mentions an effort level", () => {
    for (const key of ["frontend", "fullstack", "fullstack-db", "v2-frontend", "v2-fullstack", "v2-fullstack-db"] as const) {
      for (const selected of [false, true]) {
        const prompt = buildSystemPrompt({ templateKey: key, selected });
        expect(prompt).not.toContain("## Effort:");
        expect(prompt).not.toMatch(/up to \d+ at once/);
      }
    }
  });

  test("the directive carries the one number that depended on effort", () => {
    expect(effortDirective("LOW")).toContain("## Effort: LOW");
    expect(effortDirective("LOW")).toContain("one at a time");
    expect(effortDirective("HIGH")).toContain("up to 3 sub-agents");
    expect(effortDirective("MAX")).toContain("## Effort: MAX");
    expect(effortDirective("MAX")).toContain("up to 5 sub-agents");
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
    // One line that it exists and where the rules are; the rules themselves
    // are the `backend` guide's.
    expect(fullstack).toContain("routes go on the existing Hono `app` in `server/index.ts`");
    expect(fullstack).toContain("The `backend` guide has the rules");
    expect(fullstack).not.toContain("Do NOT create a second Hono instance");
    expect(fullstack).toContain("Tier 3 — Server API (set up) + Database (on demand)");
    expect(fullstack).not.toContain("server/db/schema.ts");
  });

  test("with a database: says it is set up, so it is not scaffolded twice", () => {
    expect(withDb).toContain("already set up and wired");
    expect(withDb).toContain("server/db/schema.ts");
    expect(withDb).toContain("The `database` guide has the rules");
    expect(withDb).toContain("Tier 3 — Server API + Database (already set up)");
    expect(withDb).not.toContain("**No database yet**");
  });

  test("the three levels differ only where the stack does", () => {
    // The rest of the prompt must not move when a backend is added, or adding
    // one would invalidate more of the provider's cache than it has to.
    const start = (p: string) => p.slice(0, p.indexOf("- Stack:"));
    const middle = (p: string) =>
      p.slice(p.indexOf("- `.tau/CONTEXT.md` is this app's memory"), p.indexOf("**Tier 3"));
    const end = (p: string) => p.slice(p.indexOf('→ Signals: "multiple users"'));
    for (const part of [start, middle, end]) {
      expect(part(frontend).length).toBeGreaterThan(200);
      expect(part(frontend)).toBe(part(fullstack));
      expect(part(fullstack)).toBe(part(withDb));
    }
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

  test("provision_sandbox offers no template to pick, only a brief to design from", () => {
    expect(Object.keys(PROVISION_SANDBOX_BASE_TOOL.function.parameters.properties)).toEqual(["brief"]);
    expect(PROVISION_SANDBOX_BASE_TOOL.function.parameters.required).toEqual([]);
  });

  test("the setup and guide tools exist only outside the generation-1 list", () => {
    const names = BASE_APP_TOOLS.map((t) => t.function.name);
    expect(names).toEqual(["enable_storage", "add_backend", "add_database", "generate_image", "dispatch_design_reviewer", "inspect_preview", "read_doc"]);
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
