import { describe, expect, test } from "bun:test";
import {
  MEMORY_MAX_CHARS,
  MEMORY_PATH,
  MEMORY_SECTIONS,
  apiRoutes,
  fileMap,
  isMemoryPath,
  memoryProblems,
  pageRoutes,
  renderAppBrief,
  tableNames,
  type FileEntry,
} from "@/worker/agent/context/appBrief";
import { clearedResultText, isClearable } from "@/worker/agent/context/clearing";
import { effortNote, shapeHistory, type HistoryRow } from "@/worker/agent/context/history";
import { buildSystemPrompt } from "@/worker/agent/config";
import { isSubstantialWork, noteWork } from "@/worker/agent/finishGate";
import { buildAppMemoryMd } from "@/worker/templates/shared";

// A generation-2 run is handed the app's memory file and a computed map of the
// app with the request, instead of opening by reading them
// (doc/CONTEXT_AND_MEMORY_PLAN.md §4). These tests pin down:
//   - the memory file's shape and size are checked by the same rules the
//     template and the prompt state;
//   - the map says what the saved files say, and quietly says less when the
//     code is unusual rather than saying something wrong;
//   - the block rides on the request in progress and nowhere else.

const file = (path: string, sizeBytes = 1200): FileEntry => ({ path, sizeBytes });

describe("the memory file's rules", () => {
  test("the empty file the template writes is a valid one", () => {
    const skeleton = buildAppMemoryMd();
    for (const section of MEMORY_SECTIONS) expect(skeleton).toContain(section);
    expect(memoryProblems(skeleton)).toEqual([]);
  });

  test("a file over the limit is told its size and the limit", () => {
    const big = `${buildAppMemoryMd()}${"x".repeat(MEMORY_MAX_CHARS)}`;
    const [problem] = memoryProblems(big);
    expect(problem).toContain(big.length.toLocaleString("en-US"));
    expect(problem).toContain("6,000");
  });

  test("a file that dropped sections is told which", () => {
    const partial = "# App memory\n\n## What this app is\nA timer.\n\n## Known issues\n_None yet._\n";
    const problems = memoryProblems(partial);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('"## Data model"');
    expect(problems[0]).toContain('"## User preferences"');
    expect(problems[0]).not.toContain('"## Known issues"');
  });

  test("the path is recognised however it is spelled", () => {
    for (const p of [MEMORY_PATH, `./${MEMORY_PATH}`, `/home/user/app/${MEMORY_PATH}`]) {
      expect(isMemoryPath(p)).toBe(true);
    }
    expect(isMemoryPath("CONTEXT.md")).toBe(false);
    expect(isMemoryPath(undefined)).toBe(false);
  });

  test("the prompt states the same sections and the same limit", () => {
    const prompt = buildSystemPrompt({ templateKey: "v2-frontend" });
    for (const section of MEMORY_SECTIONS) {
      expect(prompt).toContain(`"${section.replace("## ", "")}"`);
    }
    expect(prompt).toContain("under 6,000 characters");
  });

  test("the prompt no longer sends the agent to read the file", () => {
    for (const key of ["v2-frontend", "v2-fullstack", "v2-fullstack-db"] as const) {
      const prompt = buildSystemPrompt({ templateKey: key });
      expect(prompt).not.toContain("cat .tau/CONTEXT.md");
      expect(prompt).not.toContain("Read it first");
      expect(prompt).toContain("`<tau_app>` block");
    }
    // Generation 1 has no block, so it still has to.
    expect(buildSystemPrompt({ templateKey: "fullstack", selected: true })).toContain(
      "cat .tau/CONTEXT.md",
    );
  });
});

describe("fileMap", () => {
  test("lists the app's files, sorted, with sizes", () => {
    const map = fileMap([file("src/pages/Home.tsx", 4321), file("src/App.tsx", 812), file("package.json", 1500)]);
    expect(map.split("\n")).toEqual([
      "package.json  (1.5 kB)",
      "src/App.tsx  (812 B)",
      "src/pages/Home.tsx  (4.3 kB)",
    ]);
  });

  test("leaves out what is tau's, generated, or noise", () => {
    const map = fileMap([
      file(".tau/CONTEXT.md"),
      file(".tau/tagger.ts"),
      file("bun.lock", 90_000),
      file("data/pgdata/base/1"),
      file(".gitignore"),
      file("src/main.tsx"),
    ]);
    expect(map).toBe("src/main.tsx  (1.2 kB)");
  });

  test("folds the shadcn directory into one line", () => {
    const map = fileMap([
      file("src/components/ui/button.tsx"),
      file("src/components/ui/card.tsx"),
      file("src/components/Header.tsx"),
    ]);
    expect(map.split("\n")).toEqual([
      "src/components/Header.tsx  (1.2 kB)",
      "src/components/ui/  (2 shadcn components)",
    ]);
  });

  test("treats a legacy absolute path as the same file", () => {
    expect(fileMap([file("/home/user/app/src/App.tsx")])).toBe("src/App.tsx  (1.2 kB)");
  });

  test("a very large app is cut off, and says so", () => {
    const many = Array.from({ length: 200 }, (_, i) => file(`src/f${String(i).padStart(3, "0")}.ts`));
    const lines = fileMap(many).split("\n");
    expect(lines).toHaveLength(151);
    expect(lines[150]).toContain("and 50 more");
  });
});

describe("pageRoutes", () => {
  const paths = new Set([
    "src/App.tsx",
    "src/pages/Home.tsx",
    "src/pages/About.tsx",
    "src/pages/NotFound.tsx",
    "src/pages/settings/index.tsx",
    "src/components/Layout.tsx",
  ]);

  test("reads the routes and where each page lives", () => {
    const app = `
import { Routes, Route } from "react-router-dom"
import Home from "./pages/Home"
import About from "@/pages/About"
import { NotFound } from "./pages/NotFound"

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/about" element={<About title="About" />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}`;
    expect(pageRoutes(app, paths)).toEqual([
      "/ → Home (src/pages/Home.tsx)",
      "/about → About (src/pages/About.tsx)",
      "* → NotFound (src/pages/NotFound.tsx)",
    ]);
  });

  test("handles layouts, index routes, lazy pages and directory modules", () => {
    const app = `
import { lazy } from "react"
import Layout from "./components/Layout"
import Home from "./pages/Home"
const Settings = lazy(() => import("./pages/settings"))

<Routes>
  <Route element={<Layout />}>
    <Route index element={<Home />} />
    <Route path={"/settings"} element={<Settings />} />
  </Route>
</Routes>`;
    expect(pageRoutes(app, paths)).toEqual([
      "(layout) → Layout (src/components/Layout.tsx)",
      "(index) → Home (src/pages/Home.tsx)",
      "/settings → Settings (src/pages/settings/index.tsx)",
    ]);
  });

  test("an element that is not a saved file is listed without one", () => {
    const app = `import { Navigate } from "react-router-dom"\n<Route path="/old" element={<Navigate to="/" replace />} />`;
    expect(pageRoutes(app, paths)).toEqual(["/old → Navigate"]);
  });

  test("a file with no routes yields nothing rather than a guess", () => {
    expect(pageRoutes("export default function App() { return <Home /> }", paths)).toEqual([]);
    expect(pageRoutes("<Routes></Routes>", paths)).toEqual([]);
  });
});

describe("apiRoutes and tableNames", () => {
  test("reads the routes a server file declares", () => {
    const server = `
const app = new Hono()
app.get('/api/health', (c) => c.json({ ok: true }))
app.get("/api/notes", async (c) => c.json(await db.select().from(notes)))
app.post('/api/notes', zValidator('json', insertNoteSchema), async (c) => {
  const user = c.get('user')
  return c.json({}, 201)
})
app.delete(\`/api/notes/:id\`, async (c) => c.json({}))
`;
    expect(apiRoutes([{ path: "server/index.ts", text: server }])).toEqual([
      "GET /api/health — server/index.ts",
      "GET /api/notes — server/index.ts",
      "POST /api/notes — server/index.ts",
      "DELETE /api/notes/:id — server/index.ts",
    ]);
  });

  test("says which file each route is in, once", () => {
    const routes = apiRoutes([
      { path: "server/index.ts", text: "app.get('/api/a', h)\napp.get('/api/a', h)" },
      { path: "server/routes/users.ts", text: "users.post('/', h)" },
    ]);
    expect(routes).toEqual(["GET /api/a — server/index.ts", "POST / — server/routes/users.ts"]);
  });

  test("reads table names from a schema", () => {
    const schema = `
export const notes = pgTable('notes', { id: serial('id').primaryKey() })
export const guestbookEntries = pgTable(
  "guestbook_entries",
  { id: serial('id').primaryKey() },
)`;
    expect(tableNames(schema)).toEqual(["notes", "guestbook_entries"]);
    expect(tableNames("// nothing here")).toEqual([]);
  });
});

describe("renderAppBrief", () => {
  const memory = "# App memory\n\n## What this app is\nA guestbook.\n";
  const files = [file("src/App.tsx"), file("server/index.ts"), file("server/db/schema.ts")];

  test("carries the memory file word for word", () => {
    const brief = renderAppBrief({ memory, files }, "request");
    expect(brief.startsWith("<tau_app>\n")).toBe(true);
    expect(brief.endsWith("\n</tau_app>")).toBe(true);
    expect(brief).toContain(`<memory file="${MEMORY_PATH}">\n${memory.trimEnd()}\n</memory>`);
    expect(brief).toContain("can be edited without reading it first");
  });

  test("includes each part of the map only when there is something in it", () => {
    const bare = renderAppBrief({ memory, files: [file("src/App.tsx")] }, "request");
    expect(bare).toContain("<files>");
    expect(bare).not.toContain("<pages");
    expect(bare).not.toContain("<api_routes>");
    expect(bare).not.toContain("<tables");

    const full = renderAppBrief(
      {
        memory,
        files,
        appTsx: `<Route path="/" element={<Home />} />`,
        serverSources: [{ path: "server/index.ts", text: "app.get('/api/health', h)" }],
        schemaTs: "pgTable('notes', {})",
      },
      "request",
    );
    expect(full).toContain('<pages from="src/App.tsx">\n/ → Home\n</pages>');
    expect(full).toContain("<api_routes>\nGET /api/health — server/index.ts\n</api_routes>");
    expect(full).toContain('<tables from="server/db/schema.ts">\nnotes\n</tables>');
  });

  test("an oversized memory file is cut at the limit and the agent is told to shorten it", () => {
    const long = `${memory}${"y".repeat(MEMORY_MAX_CHARS * 2)}`;
    const brief = renderAppBrief({ memory: long, files }, "request");
    expect(brief).toContain('truncated="true"');
    expect(brief).toContain("Rewrite it shorter during this request");
    expect(brief).not.toContain("can be edited without reading it first");
    expect(brief.length).toBeLessThan(MEMORY_MAX_CHARS + 2_000);
  });

  test("an app with no memory file still gets its map", () => {
    const brief = renderAppBrief({ memory: null, files }, "request");
    expect(brief).not.toContain("<memory");
    expect(brief).toContain("<files>");
  });

  test("says who it is for", () => {
    expect(renderAppBrief({ memory, files }, "request")).toContain("at the start of this request");
    expect(renderAppBrief({ memory, files }, "provisioned")).toContain("has just been created");
    expect(renderAppBrief({ memory, files }, "sub-agent")).toContain("right now");
  });

  test("is the same text for the same input", () => {
    // It sits in the request for the whole run, so it must not change between
    // two renders of the same files.
    const parts = { memory, files: [...files].reverse() };
    expect(renderAppBrief(parts, "request")).toBe(renderAppBrief({ memory, files }, "request"));
  });
});

// ── Where the block goes ─────────────────────────────────────────────────────

describe("the block rides on the request in progress", () => {
  const rows: HistoryRow[] = [
    { sequence: 1, role: "USER", type: "USER", jobId: null, content: "build a timer" },
    { sequence: 2, role: "ASSISTANT", type: "RESULT", jobId: "job-1", content: { content: "Built.", tool_calls: null } },
    { sequence: 3, role: "USER", type: "USER", jobId: null, content: "make it blue" },
  ];
  const efforts = new Map([
    ["job-1", "HIGH"],
    ["job-2", "LOW"],
  ] as const);
  const BRIEF = "<tau_app>\nmemory and map\n</tau_app>";

  test("appended to the newest user message, after its effort note", () => {
    const entries = shapeHistory(rows, {
      currentJobId: "job-2",
      effortByJob: efforts,
      currentRequestNote: BRIEF,
    });
    expect(entries.at(-1)!.param.content).toBe(`make it blue\n\n${effortNote("LOW")}\n\n${BRIEF}`);
  });

  test("an earlier request is replayed without one", () => {
    const entries = shapeHistory(rows, {
      currentJobId: "job-2",
      effortByJob: efforts,
      currentRequestNote: BRIEF,
    });
    expect(entries[0]!.param.content).toBe(`build a timer\n\n${effortNote("HIGH")}`);
    // So what job-1 was sent, minus its block, is exactly how it is replayed:
    const asItRan = shapeHistory(rows.slice(0, 1), {
      currentJobId: "job-1",
      effortByJob: efforts,
      currentRequestNote: "<tau_app>\nolder\n</tau_app>",
    });
    expect((asItRan[0]!.param.content as string).startsWith(entries[0]!.param.content as string)).toBe(true);
  });

  test("a message with attachments gets it as one more part", () => {
    const withImage: HistoryRow[] = [
      {
        sequence: 1,
        role: "USER",
        type: "USER",
        jobId: null,
        content: [{ type: "text", text: "like this" }, { type: "image_url", image_url: { url: "https://x/y.png" } }],
      },
    ];
    const entries = shapeHistory(withImage, { currentJobId: "job-1", currentRequestNote: BRIEF });
    const parts = entries[0]!.param.content as { type: string; text?: string }[];
    expect(parts).toHaveLength(3);
    expect(parts[2]).toEqual({ type: "text", text: BRIEF });
  });

  test("nothing is added when there is no request in progress, or no block", () => {
    const outside = shapeHistory(rows, { effortByJob: efforts, currentRequestNote: BRIEF });
    expect(JSON.stringify(outside)).not.toContain("tau_app");
    const none = shapeHistory(rows, { currentJobId: "job-2", effortByJob: efforts, currentRequestNote: null });
    expect(JSON.stringify(none)).not.toContain("tau_app");
  });
});

describe("a new app's block, returned by provision_sandbox", () => {
  const call = { name: "provision_sandbox", args: {} };

  test("is cleared once a later request carries a fresh one", () => {
    const withApp = JSON.stringify({
      success: true,
      app: renderAppBrief({ memory: buildAppMemoryMd(), files: [file("src/App.tsx")] }, "provisioned"),
    });
    expect(isClearable(call, withApp)).toBe(true);
    expect(clearedResultText(call, withApp)).not.toContain("tau_app");
  });

  test("the ordinary result is left as it is", () => {
    expect(isClearable(call, JSON.stringify({ success: true }))).toBe(false);
  });
});

// ── When the agent is asked to update the memory ─────────────────────────────

describe("what counts as work the memory should record", () => {
  const log = () => ({
    created: new Set<string>(),
    edited: new Set<string>(),
    deleted: 0,
    stackGrew: false,
    memoryTouched: false,
  });
  const ok = { success: true };

  test("a small tweak is not", () => {
    const work = log();
    noteWork(work, "edit_file", { path: "src/index.css" }, ok);
    noteWork(work, "edit_file", { path: "src/index.css" }, ok);
    noteWork(work, "edit_file", { path: "src/App.tsx" }, ok);
    expect(isSubstantialWork(work)).toBe(false);
  });

  test("a new file, a removed file, a new server, or edits across many files are", () => {
    const created = log();
    noteWork(created, "create_file", { path: "src/pages/About.tsx" }, ok);
    expect(isSubstantialWork(created)).toBe(true);

    const deleted = log();
    noteWork(deleted, "delete_file", { path: "src/pages/Old.tsx" }, ok);
    expect(isSubstantialWork(deleted)).toBe(true);

    const grew = log();
    noteWork(grew, "add_database", {}, { success: true, changed: ["server/db/schema.ts"] });
    expect(isSubstantialWork(grew)).toBe(true);

    const spread = log();
    for (const p of ["a.tsx", "b.tsx", "c.tsx", "d.tsx"]) noteWork(spread, "edit_file", { path: `src/${p}` }, ok);
    expect(isSubstantialWork(spread)).toBe(true);
  });

  test("a setup tool that found everything already there is not", () => {
    const work = log();
    noteWork(work, "add_backend", {}, { success: true, alreadySetUp: true });
    expect(isSubstantialWork(work)).toBe(false);
  });

  test("writing the memory file is recorded as that, not as a new file", () => {
    const work = log();
    noteWork(work, "create_file", { path: "./.tau/CONTEXT.md", content: "…" }, ok);
    expect(work.memoryTouched).toBe(true);
    expect(isSubstantialWork(work)).toBe(false);
    noteWork(work, "edit_file", { path: "/home/user/app/.tau/CONTEXT.md" }, ok);
    expect(work.created.size + work.edited.size).toBe(0);
  });

  test("a failed call changed nothing", () => {
    const work = log();
    noteWork(work, "create_file", { path: "src/New.tsx" }, { error: "disk full" });
    noteWork(work, "edit_file", { path: ".tau/CONTEXT.md" }, { error: "old_string not found" });
    expect(isSubstantialWork(work)).toBe(false);
    expect(work.memoryTouched).toBe(false);
  });
});
