import { beforeEach, describe, expect, test } from "bun:test";
import type Sandbox from "e2b";
import {
  MAX_INSPECT_STEPS,
  inspectPreviewTool,
  parseSteps,
  resetInspectionCounts,
} from "@/worker/agent/tools/functions/inspect-preview";
import { BASE_APP_TOOLS, TOOL_DEFINITIONS } from "@/worker/agent/tools/tools";
import { deliverDocs, docStateFrom } from "@/worker/agent/docs/delivery";
import { SUB_AGENT_KINDS, subAgentPersona, type AppKind } from "@/worker/agent/tools/sub-agents/config";
import { seesBrowser, toolsFor } from "@/worker/agent/tools/sub-agents/tool-sets";
import {
  checkRender,
  createWorkLog,
  finishItems,
  gateMessage,
  noteWork,
  type GateInput,
  type GateItem,
  type RenderFault,
} from "@/worker/agent/finishGate";
import { previewInspectAvailable, type InspectOptions } from "@/worker/lib/previewInspect";
import type { PreviewReport } from "@/worker/lib/previewReport";

// `inspect_preview`, who is given it, and the check before a run may finish
// (doc/PREVIEW_DIAGNOSTICS_PLAN.md phases 1 and 2). No browser is started here:
// the part that drives one is stood in for.

const sandbox = { getHost: (port: number) => `${port}-abc123.e2b.app` } as unknown as Sandbox;

const rendered: PreviewReport = {
  path: "/",
  status: "rendered",
  summary: "The page loaded and the app is on screen.",
  document: { httpStatus: 200 },
};

function recording(report: PreviewReport = rendered, log: string | null = null) {
  const calls: { origin: string; options: InspectOptions }[] = [];
  let logReads = 0;
  return {
    calls,
    logReads: () => logReads,
    deps: (maxPerRun = 15, available = true) => ({
      available: () => available,
      maxPerRun,
      readLog: async () => {
        logReads++;
        return log;
      },
      inspect: async (origin: string, options: InspectOptions) => {
        calls.push({ origin, options });
        return report;
      },
    }),
  };
}

describe("inspect_preview", () => {
  beforeEach(resetInspectionCounts);

  test("opens the app's own preview, at the route asked for", async () => {
    const rec = recording();
    const out = await inspectPreviewTool({ path: "pricing", viewport: "mobile", verbose: true }, sandbox, "job-1", rec.deps());
    expect(rec.calls).toEqual([
      {
        origin: "https://5173-abc123.e2b.app",
        options: { path: "/pricing", steps: [], viewport: "mobile", verbose: true },
      },
    ]);
    expect(out).toEqual(rendered);
  });

  test("defaults to the home page at desktop width, errors and warnings only", async () => {
    const rec = recording();
    await inspectPreviewTool({}, sandbox, "job-1", rec.deps());
    expect(rec.calls[0]!.options).toEqual({ path: "/", steps: [], viewport: "desktop", verbose: false });
  });

  test("where there is no browser it says so, and opens nothing", async () => {
    const rec = recording();
    const out = await inspectPreviewTool({}, sandbox, "job-1", rec.deps(15, false));
    expect(out).toMatchObject({ unavailable: true });
    expect((out as { error: string }).error).toContain("Do not call this again");
    expect(rec.calls).toHaveLength(0);
  });

  test("a run has a limited number, counted across everyone working on it", async () => {
    const rec = recording();
    const deps = rec.deps(2);
    await inspectPreviewTool({}, sandbox, "job-1", deps);
    await inspectPreviewTool({ path: "/menu" }, sandbox, "job-1", deps);
    const third = await inspectPreviewTool({}, sandbox, "job-1", deps);
    expect(third).toMatchObject({ refused: true });
    expect(rec.calls).toHaveLength(2);
    // Another run has its own.
    expect(await inspectPreviewTool({}, sandbox, "job-2", deps)).toMatchObject({ status: "rendered" });
  });

  test("says how many are left once they are running out", async () => {
    const rec = recording();
    const deps = rec.deps(5);
    expect(await inspectPreviewTool({}, sandbox, "job-1", deps)).not.toHaveProperty("inspectionsLeft");
    expect(await inspectPreviewTool({}, sandbox, "job-1", deps)).toMatchObject({ inspectionsLeft: 3 });
  });

  test("what the dev server printed comes with a page that would not compile or load, and no other", async () => {
    const LOG = '[vite] Internal server error: Failed to resolve import "./missing"';
    for (const status of ["build_error", "unreachable"] as const) {
      const rec = recording({ ...rendered, status }, LOG);
      expect(await inspectPreviewTool({}, sandbox, `job-${status}`, rec.deps())).toMatchObject({ status, devServerLog: LOG });
    }
    for (const status of ["rendered", "rendered_with_errors", "crashed", "blank"] as const) {
      const rec = recording({ ...rendered, status }, LOG);
      expect(await inspectPreviewTool({}, sandbox, `job-${status}`, rec.deps())).not.toHaveProperty("devServerLog");
      // Not read at all: it is a file in the sandbox, and reading it takes time.
      expect(rec.logReads()).toBe(0);
    }
  });

  test("a sandbox that keeps no log, or will not give it up, costs the result nothing else", async () => {
    const none = recording({ ...rendered, status: "build_error" }, null);
    expect(await inspectPreviewTool({}, sandbox, "job-a", none.deps())).not.toHaveProperty("devServerLog");

    const failing = {
      ...recording({ ...rendered, status: "build_error" }).deps(),
      readLog: async (): Promise<string | null> => {
        throw new Error("sandbox gone");
      },
    };
    expect(await inspectPreviewTool({}, sandbox, "job-b", failing)).toMatchObject({ status: "build_error" });
  });

  test("steps are found by what they say, capped, and anything malformed is dropped", () => {
    expect(
      parseSteps([
        { click: "  Sign in " },
        { fill: "Email", with: "a@b.co" },
        { fill: "No value" },
        "open the menu",
        null,
        { click: "" },
      ]),
    ).toEqual([{ click: "Sign in" }, { fill: "Email", with: "a@b.co" }]);
    expect(parseSteps(Array.from({ length: 9 }, (_, i) => ({ click: `Tab ${i}` })))).toHaveLength(MAX_INSPECT_STEPS);
    expect(parseSteps("click everything")).toEqual([]);
  });

  test("the debugging guide comes with the first result that found a fault, not the first result", () => {
    const state = docStateFrom([]);
    // An app that is working needs no guide to fixing it.
    const clean = deliverDocs(state, "inspect_preview", {}, { ...rendered });
    expect(clean.delivered).toEqual([]);
    expect(clean.output).toEqual(rendered);

    const crashed = deliverDocs(state, "inspect_preview", {}, { ...rendered, status: "crashed" });
    expect(crashed.delivered).toEqual([{ name: "debugging", via: "first_use", repeat: false }]);
    expect((crashed.output as { attachedGuide: string }).attachedGuide).toContain("# Debugging a broken preview");
    // Once it is in the conversation it is not attached again.
    expect(deliverDocs(state, "inspect_preview", {}, { ...rendered, status: "blank" }).delivered).toEqual([]);
  });

  test("is a tool of the base app only, so the older apps are sent the list they always were", () => {
    expect(BASE_APP_TOOLS.map((t) => t.function.name)).toContain("inspect_preview");
    expect(TOOL_DEFINITIONS.map((t) => t.function.name) as string[]).not.toContain("inspect_preview");
  });
});

describe("who can open the app in a browser", () => {
  const names = (kind: (typeof SUB_AGENT_KINDS)[number], generation: 1 | 2) =>
    toolsFor(kind, generation).map((t) => (t.type === "function" ? t.function.name : ""));

  test("the debugger and the verifier, on the base app, where there is a browser", () => {
    const has = previewInspectAvailable();
    for (const kind of ["debugger", "verifier"] as const) {
      expect(seesBrowser(kind, 2)).toBe(has);
      expect(names(kind, 2).includes("inspect_preview")).toBe(has);
    }
  });

  test("never the explorer or the implementer, and nobody on the older apps", () => {
    for (const kind of ["explorer", "implementer"] as const) {
      expect(names(kind, 2)).not.toContain("inspect_preview");
    }
    for (const kind of SUB_AGENT_KINDS) expect(names(kind, 1)).not.toContain("inspect_preview");
  });
});

describe("what a sub-agent is told about seeing the app", () => {
  const blind: AppKind = { generation: 2, hasServer: false, hasDb: false, browser: false };
  const seeing: AppKind = { ...blind, browser: true };
  const seeingWithApi: AppKind = { generation: 2, hasServer: true, hasDb: false, browser: true };

  test("a verifier with a browser checks that screens render, not that the page answers", () => {
    const persona = subAgentPersona("verifier", seeing);
    expect(persona).toContain("Each screen in scope renders: call `inspect_preview`");
    expect(persona).toContain("the page answers 200 whether or not the app in it has crashed");
    expect(persona).not.toContain("You cannot see the app rendered");
    // It still cannot judge looks.
    expect(persona).toContain("do not report on how it looks");
    expect(subAgentPersona("verifier", seeingWithApi)).toContain("The screens in scope render: call `inspect_preview`");
  });

  test("a verifier without one is told what it cannot see, as before", () => {
    const persona = subAgentPersona("verifier", blind);
    expect(persona).toContain("You cannot see the app rendered");
    expect(persona).toContain("The page loads: `curl");
    expect(persona).not.toContain("inspect_preview");
  });

  test("a debugger with a browser looks before it reads", () => {
    const persona = subAgentPersona("debugger", seeing);
    expect(persona).toContain("call `inspect_preview` on the route first");
    // It is no longer told to read output nobody can read.
    expect(persona).not.toContain("read the dev server's output");
    expect(subAgentPersona("debugger", blind)).not.toContain("inspect_preview");
  });

  test("the explorer and the implementer are told nothing about it", () => {
    for (const kind of ["explorer", "implementer"] as const) {
      expect(subAgentPersona(kind, seeing)).not.toContain("inspect_preview");
    }
  });
});

// Every other check passes on an app that shows nothing, because the page
// answers 200 whatever the JavaScript in it does. So before a run that changed
// files may finish, tau opens the app itself.
describe("a run may not finish on an app that does not work", () => {
  const fault = (over: Partial<RenderFault> = {}): RenderFault => ({
    status: "crashed",
    summary: "The page loaded but nothing rendered: an error was thrown while the app started.",
    findings: "- Error thrown at `src/pages/Home.tsx:42:18`: TypeError: items.map is not a function",
    canInspect: true,
    ...over,
  });

  const input = (over: Partial<GateInput> = {}): GateInput => ({
    generation: 2,
    effort: "LOW",
    work: createWorkLog(),
    filesChanged: true,
    verifierRan: false,
    reviewerRan: false,
    design: null,
    reported: new Set<string>(),
    sandbox: { files: { read: async () => { throw new Error("no such file"); } } },
    projectId: "p",
    userId: "u",
    previewUrl: "https://5173-abc123.e2b.app",
    renderCheck: async () => fault(),
    ...over,
  });

  test("it is sent back with what the browser saw, at every effort", async () => {
    for (const effort of ["LOW", "HIGH", "MAX"] as const) {
      const owed = await finishItems(input({ effort, verifierRan: true }), new Set<GateItem["kind"]>());
      expect(owed.map((item) => item.kind)).toEqual(["render"]);
      expect(owed[0]!.reason).toBe("crashed");
      expect(owed[0]!.text).toContain("**Fix the app: it does not work.**");
      expect(owed[0]!.text).toContain("TypeError: items.map is not a function");
      expect(owed[0]!.text).toContain("call `inspect_preview` to confirm");
    }
  });

  test("an app that renders owes nothing, and nothing about the check reaches the model", async () => {
    expect(await finishItems(input({ renderCheck: async () => null }), new Set<GateItem["kind"]>())).toEqual([]);
  });

  test("it is asked for once: a run still broken afterwards ends anyway", async () => {
    const state = new Set<GateItem["kind"]>();
    let opened = 0;
    const check = async () => {
      opened++;
      return fault();
    };
    expect(await finishItems(input({ renderCheck: check }), state)).toHaveLength(1);
    expect(await finishItems(input({ renderCheck: check }), state)).toEqual([]);
    expect(opened).toBe(1);
  });

  test("the app is not opened for a run that changed nothing, has no preview, or is on an older app", async () => {
    let opened = 0;
    const check = async () => {
      opened++;
      return fault();
    };
    const state = () => new Set<GateItem["kind"]>();
    expect(await finishItems(input({ renderCheck: check, filesChanged: false }), state())).toEqual([]);
    expect(await finishItems(input({ renderCheck: check, previewUrl: null }), state())).toEqual([]);
    expect(await finishItems(input({ renderCheck: check, generation: 1 }), state())).toEqual([]);
    expect(opened).toBe(0);
  });

  test("a check that fails, or never comes back, costs the check and not the run", async () => {
    const throwing = async (): Promise<RenderFault | null> => {
      throw new Error("the browser went away");
    };
    expect(await finishItems(input({ renderCheck: throwing }), new Set<GateItem["kind"]>())).toEqual([]);

    const state = new Set<GateItem["kind"]>();
    const started = Date.now();
    expect(await finishItems(input({ renderCheck: () => new Promise<RenderFault | null>(() => {}) }), state, 40, 40)).toEqual([]);
    expect(Date.now() - started).toBeLessThan(2_000);
    // Nothing was asked for, so it may still be asked for.
    expect(state.has("render")).toBe(false);
  });

  test("it comes before everything else that is owed", async () => {
    const work = createWorkLog();
    noteWork(work, "edit_file", { path: "src/pages/Home.tsx" }, { success: true });
    const drifted = {
      files: {
        read: async (path: string) => {
          if (path.endsWith("src/pages/Home.tsx")) return '<p className="text-blue-500">Opening hours</p>';
          throw new Error("no such file");
        },
      },
    };
    const owed = await finishItems(input({ work, design: {}, sandbox: drifted }), new Set<GateItem["kind"]>());
    expect(owed.map((item) => item.kind)).toEqual(["render", "design_check"]);
    const message = gateMessage(owed);
    expect(message.indexOf("1. **Fix the app: it does not work.**")).toBeGreaterThan(-1);
    expect(message.indexOf("1. **Fix the app")).toBeLessThan(message.indexOf("2. **Fix these design faults**"));
  });

  // On the first real run this check called a working app blank: nobody had
  // opened it yet, the dev server was still preparing it, and for ten seconds
  // an app in that state looks exactly like one that draws nothing. The run was
  // sent back and spent fifteen more steps on an app with nothing wrong.
  describe("a fault is looked at twice before it is believed", () => {
    const report = (status: PreviewReport["status"], over: Partial<PreviewReport> = {}): PreviewReport => ({
      path: "/",
      status,
      summary: `the app is ${status}`,
      document: { httpStatus: 200 },
      ...over,
    });
    const looks = (...statuses: PreviewReport[]) => {
      const seen: InspectOptions[] = [];
      return {
        seen,
        parts: {
          available: () => true,
          redact: async (_projectId: string, text: string) => text,
          inspect: async (_url: string, options: InspectOptions) => {
            seen.push(options);
            return statuses[Math.min(seen.length - 1, statuses.length - 1)]!;
          },
        },
      };
    };
    const URL = "https://5173-abc123.e2b.app";

    test("an app that is fine is looked at once", async () => {
      const l = looks(report("rendered"));
      expect(await checkRender(URL, "p", l.parts)).toBeNull();
      expect(l.seen).toHaveLength(1);
    });

    test("blank at first and fine a moment later was a slow start, not a fault", async () => {
      const l = looks(report("blank"), report("rendered"));
      expect(await checkRender(URL, "p", l.parts)).toBeNull();
      expect(l.seen).toHaveLength(2);
    });

    test("broken both times is broken, and what is reported is the second look", async () => {
      const crashed = (message: string) =>
        report("crashed", { exceptions: [{ message, at: "src/App.tsx:6:22", count: 1 }] });
      const l = looks(crashed("TypeError: first look"), crashed("TypeError: second look"));
      const fault = await checkRender(URL, "p", l.parts);
      expect(fault?.status).toBe("crashed");
      expect(fault?.findings).toContain("TypeError: second look");
      expect(fault?.findings).not.toContain("first look");
      expect(fault?.canInspect).toBe(true);
    });

    test("a second look that cannot tell does not confirm the first", async () => {
      const l = looks(report("blank"), report("unreachable"));
      expect(await checkRender(URL, "p", l.parts)).toBeNull();
    });

    test("with no time for a second look, an error that was seen still counts and an empty page does not", async () => {
      const noTime = { budgetMs: 1_000, secondLookMinMs: 5_000 };
      const crashed = looks(report("crashed", { exceptions: [{ message: "TypeError: boom", count: 1 }] }));
      expect((await checkRender(URL, "p", { ...crashed.parts, ...noTime }))?.status).toBe("crashed");
      expect(crashed.seen).toHaveLength(1);

      const blank = looks(report("blank"));
      expect(await checkRender(URL, "p", { ...blank.parts, ...noTime })).toBeNull();
    });

    test("what goes to the model has had keys taken out of it", async () => {
      const l = looks(report("crashed", { exceptions: [{ message: "Error: bad key tau_sk_live_abcdefgh12345678", count: 1 }] }));
      const fault = await checkRender(URL, "p", {
        ...l.parts,
        redact: async (_projectId: string, text: string) => text.replace(/tau_sk_\w+/g, "tau_sk_***"),
      });
      expect(fault?.findings).toContain("tau_sk_***");
      expect(fault?.findings).not.toContain("abcdefgh12345678");
    });

    test("an app that does not compile is sent back with the end of the dev server log", async () => {
      const broken = report("build_error", { buildError: { message: "Failed to resolve import", file: "src/App.tsx" } });
      const l = looks(broken, broken);
      const fault = await checkRender(URL, "p", { ...l.parts, devLog: async () => "[vite] Pre-transform error: no such file" });
      expect(fault?.findings).toContain("- Build error in `src/App.tsx`: Failed to resolve import");
      expect(fault?.findings).toContain("log ends:\n```\n[vite] Pre-transform error: no such file\n```");

      // A crash is in the browser, not the dev server: its log is not read.
      let read = 0;
      const crashed = report("crashed", { exceptions: [{ message: "TypeError: boom", count: 1 }] });
      const c = looks(crashed, crashed);
      const crash = await checkRender(URL, "p", {
        ...c.parts,
        devLog: async () => {
          read++;
          return "noise";
        },
      });
      expect(crash?.findings).not.toContain("dev server");
      expect(read).toBe(0);
    });

    test("a log that cannot be read does not stop the fault being reported", async () => {
      const broken = report("build_error", { buildError: { message: "Unexpected token" } });
      const l = looks(broken, broken);
      const fault = await checkRender(URL, "p", {
        ...l.parts,
        devLog: async (): Promise<string | null> => {
          throw new Error("gone");
        },
      });
      expect(fault?.status).toBe("build_error");
      expect(fault?.findings).not.toContain("dev server");
    });

    test("where there is no browser, the dev server still says whether the app compiles", async () => {
      const parts = (state: "ready" | "build-error" | "starting") => ({
        available: () => false,
        probe: async () => state,
      });
      expect(await checkRender(URL, "p", parts("ready"))).toBeNull();
      expect(await checkRender(URL, "p", parts("starting"))).toBeNull();
      expect(await checkRender(URL, "p", parts("build-error"))).toMatchObject({ status: "build_error", canInspect: false });
    });
  });

  test("without a browser the agent is told to type-check, not to use a tool it does not have", async () => {
    const owed = await finishItems(
      input({
        renderCheck: async () =>
          fault({ status: "build_error", summary: "The app does not compile, so nothing can render.", canInspect: false }),
      }),
      new Set<GateItem["kind"]>(),
    );
    expect(owed[0]!.reason).toBe("build_error");
    expect(owed[0]!.text).toContain("type-check to confirm it compiles");
    expect(owed[0]!.text).not.toContain("inspect_preview");
  });
});
