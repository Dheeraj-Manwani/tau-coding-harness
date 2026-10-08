import { describe, expect, test } from "bun:test";
import { reasoningOf, shapeHistory } from "@/worker/agent/context/history";
import { pageFiles, pageRoutes, renderAppBrief, type FileEntry } from "@/worker/agent/context/appBrief";
import { stemOf, searchStems, toMatches, type StoredRow } from "@/worker/agent/context/lookup";
import { toolsFor } from "@/worker/agent/tools/sub-agents/tool-sets";
import {
  MAX_SHELL_FILES,
  MAX_TEXT_BYTES,
  chooseFiles,
  isProjectPath,
  parseFound,
} from "@/worker/agent/tools/functions/shell-changes";
import { createWorkLog, isSubstantialWork, noteWork } from "@/worker/agent/finishGate";
import { TURN_CAP_NUDGE } from "@/worker/agent/loop";

// Phase 7 of doc/CONTEXT_AND_MEMORY_PLAN.md §11: what the agent can see of an
// app that is built unusually, what a shell command leaves behind, how a
// history search ranks, and what a run says when it runs out of turns.

const file = (path: string, sizeBytes = 900): FileEntry => ({ path, sizeBytes });

describe("the map of an app's pages", () => {
  const paths = (...p: string[]) => new Set(p);

  test("reads routes written as data, as well as <Route> elements", () => {
    const app = `
      import Home from "./pages/Home";
      import { About } from "./pages/About";
      const router = createBrowserRouter([
        { path: "/", element: <Home /> },
        { path: "/about", element: <About />, errorElement: <Oops /> },
        { index: true, Component: Home },
      ]);`;
    const found = pageRoutes(app, paths("src/pages/Home.tsx", "src/pages/About.tsx"));
    expect(found).toEqual([
      "/ → Home (src/pages/Home.tsx)",
      "/about → About (src/pages/About.tsx)",
      "(index) → Home (src/pages/Home.tsx)",
    ]);
  });

  test("an App that routes by state has no routes to read, and the files that look like screens are listed instead", () => {
    const app = `const [tab, setTab] = useState("home"); return tab === "home" ? <Home /> : <Pricing />;`;
    expect(pageRoutes(app, paths())).toEqual([]);
    const brief = renderAppBrief(
      {
        memory: null,
        files: [file("src/App.tsx"), file("src/pages/Home.tsx"), file("src/pages/Pricing.tsx"), file("src/components/Nav.tsx")],
        appTsx: app,
      },
      "request",
    );
    expect(brief).toContain("no routes could be read from src/App.tsx");
    expect(brief).toContain("src/pages/Home.tsx\nsrc/pages/Pricing.tsx");
    expect(brief).not.toContain("Nav.tsx\nsrc");
  });

  test("an app with neither says nothing about pages, which is not the same as saying there are none", () => {
    const brief = renderAppBrief({ memory: null, files: [file("src/App.tsx")], appTsx: "export default () => null" }, "request");
    expect(brief).not.toContain("<pages");
    expect(pageFiles(paths("src/App.tsx", "src/pages/nested/Deep.tsx", "src/views/List.jsx"))).toEqual(["src/views/List.jsx"]);
  });
});

describe("the files a shell command leaves behind", () => {
  test("are read from the output of find, spaces and all", () => {
    expect(parseFound("200 public/a.png\n2 src/components/ui/x.tsx\n11 src/with space.ts\nnonsense\n")).toEqual([
      { path: "public/a.png", size: 200 },
      { path: "src/components/ui/x.tsx", size: 2 },
      { path: "src/with space.ts", size: 11 },
    ]);
  });

  test("are the project's files, not its dependencies, build output, caches, logs or secrets", () => {
    for (const path of ["src/App.tsx", "package.json", "bun.lock", "public/hero.jpg", "components.json", "src/data/menu.json"]) {
      expect(isProjectPath(path)).toBe(true);
    }
    for (const path of [
      "node_modules/react/index.js",
      "src/node_modules/x.js",
      "dist/index.html",
      "build/out.js",
      ".git/HEAD",
      ".vite/deps/x.js",
      ".tau/logs/1-build.out",
      "tsconfig.tsbuildinfo",
      "debug.log",
      ".env",
      ".env.local",
      "keys/server.pem",
      "../outside",
      "/etc/passwd",
    ]) {
      expect(isProjectPath(path)).toBe(false);
    }
  });

  test("are limited in number and in size, and what is left out is said", () => {
    const many = Array.from({ length: MAX_SHELL_FILES + 5 }, (_, i) => ({ path: `src/gen/f${String(i).padStart(3, "0")}.ts`, size: 100 }));
    const { save, skipped } = chooseFiles(many);
    expect(save).toHaveLength(MAX_SHELL_FILES);
    expect(skipped).toHaveLength(5);
    expect(skipped[0]!.why).toContain(`${MAX_SHELL_FILES} files`);

    const sized = chooseFiles([
      { path: "src/big.json", size: MAX_TEXT_BYTES + 1 },
      { path: "public/photo.jpg", size: MAX_TEXT_BYTES + 1 },
      { path: "src/small.ts", size: 10 },
    ]);
    // A picture may be larger than a text file; neither may be as large as a runaway.
    expect(sized.save.map((f) => f.path)).toEqual(["public/photo.jpg", "src/small.ts"]);
    expect(sized.skipped.map((s) => s.path)).toEqual(["src/big.json"]);

    const crowd = Array.from({ length: 5 }, (_, i) => ({ path: `public/p${i}.png`, size: 7 * 1024 * 1024 }));
    expect(chooseFiles(crowd).save.length).toBeLessThan(5);
  });

  test("count as files the run created, for whether its memory should be updated", () => {
    const work = createWorkLog();
    noteWork(work, "run_command", { command: "bunx shadcn add dialog" }, { exitCode: 0, savedFiles: ["src/components/ui/dialog.tsx"] });
    expect([...work.created]).toEqual(["src/components/ui/dialog.tsx"]);
    expect(isSubstantialWork(work)).toBe(true);
    const idle = createWorkLog();
    noteWork(idle, "run_command", { command: "ls" }, { exitCode: 0 });
    expect(isSubstantialWork(idle)).toBe(false);
  });
});

describe("searching the history", () => {
  const row = (sequence: number, role: string, content: unknown, hits?: number): StoredRow => ({
    sequence, role, type: role === "USER" ? "USER" : "RESULT", content, createdAt: new Date("2026-10-08"), ...(hits === undefined ? {} : { hits }),
  });

  test("a word is cut back to what its forms share, and a phrase or a short word is not", () => {
    expect(stemOf("measures")).toBe("measur");
    expect(stemOf("measurements")).toBe("measure");
    expect(stemOf("pricing")).toBe("pric");
    expect(stemOf("priced")).toBe("pric");
    expect(stemOf("css")).toBe("css");
    expect(stemOf("dark mode toggle")).toBe("dark mode toggle");
    expect(stemOf("stripe")).toBe("stripe");
    expect(searchStems(["pricing", "priced"])).toEqual(["pric"]);
  });

  test("what was said with every word comes first, then the rest by how many words they have", () => {
    const rows = [
      row(9, "USER", "just the pricing page", 1),
      row(7, "ASSISTANT", { content: "the pricing page headline is done" }, 2),
      row(5, "USER", "make the pricing headline bigger", 2),
      row(3, "USER", "a bigger headline", 1),
    ];
    expect(toMatches(rows, ["pricing", "headline"]).map((m) => m.n)).toEqual([7, 5, 9, 3]);
  });

  test("a row with no count is taken to have every word, as it was when the search needed them all", () => {
    expect(toMatches([row(2, "USER", "the pricing headline")], ["pricing", "headline"]).map((m) => m.n)).toEqual([2]);
  });
});

const toolNames = (kind: Parameters<typeof toolsFor>[0], generation: 1 | 2) =>
  toolsFor(kind, generation).map((t) => (t as { function: { name: string } }).function.name);

describe("sub-agents on the base app", () => {
  test("can look back through the conversation, and are told how", () => {
    const names = toolNames("debugger", 2);
    expect(names).toContain("search_history");
    expect(names).toContain("read_doc");
    // On the older apps they have neither, as before.
    expect(toolNames("debugger", 1)).not.toContain("search_history");
    expect(toolNames("implementer", 2)).toContain("search_history");
  });
});

describe("a run that uses all its turns", () => {
  test("is given one more, without tools, to say where it got to", () => {
    expect(TURN_CAP_NUDGE).toContain("used all the turns");
    expect(TURN_CAP_NUDGE).toContain("no more tool calls");
    expect(TURN_CAP_NUDGE).toContain("what you did not get to");
    expect(TURN_CAP_NUDGE).toContain("what to ask for next");
  });
});

describe("replaying a turn that called tools", () => {
  const stored = (content: object) => ({
    sequence: 2, role: "ASSISTANT", type: "TOOL_REQ", jobId: "j1", createdAt: new Date("2026-10-08"), content,
  });
  const calls = [{ id: "c1", type: "function", function: { name: "ls", arguments: "{}" } }];

  test("gives back the reasoning it kept, and an empty one for turns stored without it", () => {
    const kept = shapeHistory([stored({ content: null, tool_calls: calls, reasoning_content: "because" })] as never, { currentJobId: "j1" });
    expect((kept[0]!.param as { reasoning_content?: string }).reasoning_content).toBe("because");
    const old = shapeHistory([stored({ content: null, tool_calls: calls })] as never, { currentJobId: "j1" });
    expect((old[0]!.param as { reasoning_content?: string }).reasoning_content).toBe("");
  });

  test("keeps the model's reasoning to store, and nothing when there was none", () => {
    expect(reasoningOf({ reasoning_content: "why" })).toEqual({ reasoning_content: "why" });
    expect(reasoningOf({ content: "x" })).toEqual({});
    expect(reasoningOf({ reasoning_content: "" })).toEqual({});
  });
});
