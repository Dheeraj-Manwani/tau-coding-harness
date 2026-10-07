import { describe, expect, test } from "bun:test";
import type OpenAI from "openai";
import { renderAppBrief } from "@/worker/agent/context/appBrief";
import { createClearingState } from "@/worker/agent/context/clearing";
import { shapeHistory } from "@/worker/agent/context/history";
import { RESTORED_HEADER, isRestoredState, messageText } from "@/worker/agent/context/marks";
import {
  MAX_RESTORED_PATHS,
  MAX_RESTORED_REQUEST_CHARS,
  renderRestoredState,
  restoredEntry,
  type RunState,
} from "@/worker/agent/context/restore";
import {
  SUMMARIZER_SYSTEM,
  SUMMARY_HEADER,
  SUMMARY_SECTIONS,
  withoutTauBlocks,
} from "@/worker/agent/context/summarize";
import { estimateTokens } from "@/worker/agent/context/tokens";
import {
  applyPlanCall,
  normalizeStatus,
  openTodos,
  renderPlan,
  replayPlan,
  type PlanCall,
} from "@/worker/agent/plan";
import {
  MAX_REPORT_CHARS,
  SUB_AGENT_KINDS,
  appFacts,
  subAgentPersona,
  typeCheckCommand,
  type AppKind,
} from "@/worker/agent/tools/sub-agents/config";
import {
  FINAL_REPORT_NUDGE,
  boundedContext,
  capReport,
  subAgentContextTokens,
  turnBudgetNote,
} from "@/worker/agent/tools/sub-agents/sub-agent-executor";
import { toolsFor } from "@/worker/agent/tools/sub-agents/tool-sets";
import { TOOL_DEFINITIONS } from "@/worker/agent/tools/tools";

type MessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam;

// A long build outlives its own context. What was said at the start is
// cleared or summarized long before the work is finished, and three things
// went with it: the agent's plan, the user's request, and — for a sub-agent
// sent to read widely — any bound on what it carried around
// (doc/CONTEXT_AND_MEMORY_PLAN.md §7, items 7 to 9).

const call = (tool: string, input: unknown): PlanCall => ({ tool, input });
const BUILD: PlanCall[] = [
  call("create_plan", { name: "Bakery site", description: "One page", todos: ["Show what they bake", "Show the menu", "Show opening hours"] }),
  call("update_todo", { sno: 1, status: "done" }),
  call("add_todos", { todos: ["Add a map"] }),
  call("update_todo", { sno: 2, status: "done" }),
  call("update_todo", { sno: 4, status: "blocked" }),
];

describe("the plan is state, not a memory", () => {
  test("it is the plan calls replayed, in order", () => {
    expect(replayPlan(BUILD)).toEqual({
      name: "Bakery site",
      description: "One page",
      todos: [
        { sno: 1, text: "Show what they bake", status: "done" },
        { sno: 2, text: "Show the menu", status: "done" },
        { sno: 3, text: "Show opening hours", status: "pending" },
        { sno: 4, text: "Add a map", status: "blocked" },
      ],
    });
    expect(replayPlan([])).toBeNull();
  });

  test("a call that makes no sense changes nothing", () => {
    // No plan yet.
    expect(replayPlan([call("update_todo", { sno: 1, status: "done" }), call("add_todos", { todos: ["x"] })])).toBeNull();
    const plan = replayPlan(BUILD)!;
    expect(applyPlanCall(plan, call("update_todo", { sno: 9, status: "done" }))).toBe(plan);
    expect(applyPlanCall(plan, call("update_todo", { sno: 1, status: "finished" }))).toBe(plan);
    expect(applyPlanCall(plan, call("update_todo", null))).toBe(plan);
    expect(applyPlanCall(plan, call("create_plan", { description: "no name" }))).toBe(plan);
    expect(applyPlanCall(plan, call("read_file", { path: "x" }))).toBe(plan);
  });

  test("a new plan replaces the old one and starts again from pending", () => {
    const again = replayPlan([...BUILD, call("create_plan", { name: "Round two", description: "", todos: ["Fix the header"] })])!;
    expect(again.name).toBe("Round two");
    expect(again.todos).toEqual([{ sno: 1, text: "Fix the header", status: "pending" }]);
  });

  test("statuses are read leniently and nothing else is one", () => {
    expect(normalizeStatus(" Done ")).toBe("done");
    expect(normalizeStatus("SKIPPED")).toBe("skipped");
    expect(normalizeStatus("in progress")).toBeNull();
    expect(normalizeStatus(1)).toBeNull();
  });

  test("it is handed back whole, with where things stand", () => {
    const text = renderPlan(replayPlan(BUILD)!);
    expect(text.split("\n")).toEqual([
      "Plan: Bakery site",
      "1. [done] Show what they bake",
      "2. [done] Show the menu",
      "3. [pending] Show opening hours",
      "4. [blocked] Add a map",
      "2 of 4 done; 1 blocked; next: 3. Show opening hours.",
    ]);
    expect(openTodos(replayPlan(BUILD)!).map((t) => t.sno)).toEqual([3, 4]);
  });

  test("a finished plan and an empty one say so", () => {
    const done = replayPlan([call("create_plan", { name: "Tiny", description: "", todos: ["One thing"] }), call("update_todo", { sno: 1, status: "done" })])!;
    expect(renderPlan(done)).toContain("1 of 1 done; nothing pending.");
    expect(openTodos(done)).toEqual([]);
    expect(renderPlan(replayPlan([call("create_plan", { name: "Bare", description: "" })])!)).toContain("no todos yet");
  });

  test("every plan tool says it returns the plan", () => {
    for (const name of ["create_plan", "add_todos", "update_todo"]) {
      const tool = TOOL_DEFINITIONS.find((t) => t.function.name === name)!;
      expect(tool.function.description).toMatch(/Returns the (whole )?plan/);
    }
  });
});

// ── After a summary ──────────────────────────────────────────────────────────

const BRIEF = renderAppBrief(
  {
    memory: "## What this app is\nA bakery's site.\n",
    design: "---\nname: x\n---\n# Design — Craft\n\n## Overview\nWarm and handmade.\n",
    files: [{ path: "src/pages/Home.tsx", sizeBytes: 4200 }],
  },
  "restored",
);

const STATE: RunState = {
  request: "Build a site for my bakery. Do NOT use any brown — I hate brown.",
  effort: "HIGH",
  plan: replayPlan(BUILD),
  work: { created: ["src/pages/Home.tsx", "src/data/menu.ts"], edited: ["src/App.tsx"], deleted: 1 },
  guides: ["layouts", "components"],
  brief: BRIEF,
};

describe("what is put back after a summary", () => {
  const text = renderRestoredState(STATE);

  test("the user's request, word for word, with the effort they chose", () => {
    expect(text).toContain("<user_request>\nBuild a site for my bakery. Do NOT use any brown — I hate brown.\n</user_request>");
    expect(text).toContain("<tau_effort>");
    expect(text.indexOf("<user_request>")).toBeLessThan(text.indexOf("<tau_effort>"));
  });

  test("the plan as it stood, and that a later plan result is newer", () => {
    expect(text).toContain("3. [pending] Show opening hours");
    expect(text).toContain("A later `update_todo` or `add_todos` result is newer than this.");
    expect(renderRestoredState({ ...STATE, plan: null })).toContain("No plan has been made for this request.");
  });

  test("which files the run has changed, and that their contents are gone", () => {
    expect(text).toContain("- created: `src/data/menu.ts`, `src/pages/Home.tsx`");
    expect(text).toContain("- edited: `src/App.tsx`");
    expect(text).toContain("- deleted: 1 file");
    expect(text).toContain("Read a file again before editing it.");
    // Nothing changed: nothing said.
    expect(renderRestoredState({ ...STATE, work: { created: [], edited: [], deleted: 0 } })).not.toContain("Files changed");
    expect(renderRestoredState({ ...STATE, work: null })).not.toContain("Files changed");
  });

  test("which guides it had read, and how it gets them back", () => {
    expect(text).toContain("`layouts`, `components`");
    expect(text).toContain("`read_doc` gets one now");
    expect(renderRestoredState({ ...STATE, guides: [] })).not.toContain("## Guides");
  });

  test("the app's memory, design and map, read fresh, last", () => {
    expect(text).toContain("<tau_app>");
    expect(text).toContain("A bakery's site.");
    expect(text).toContain("Warm and handmade.");
    expect(text).toContain("read from its saved files a moment ago");
    expect(text.trimEnd().endsWith("</tau_app>")).toBe(true);
  });

  test("it says what it is, so it is not answered as a new message", () => {
    expect(text.startsWith(RESTORED_HEADER)).toBe(true);
    expect(text).toContain("It is not a new message from the user and needs no reply: carry on with the work.");
    const entry = restoredEntry(STATE);
    expect(entry.seq).toBeNull();
    expect(entry.param.role).toBe("user");
    expect(isRestoredState(entry.param)).toBe(true);
    expect(isRestoredState({ role: "user", content: "Build a site" })).toBe(false);
    expect(isRestoredState({ role: "system", content: RESTORED_HEADER })).toBe(false);
  });

  test("it has a size it cannot exceed whatever the run did", () => {
    const huge = renderRestoredState({
      ...STATE,
      request: "x".repeat(50_000),
      work: {
        created: Array.from({ length: 500 }, (_, i) => `src/generated/file-${i}.tsx`),
        edited: [],
        deleted: 0,
      },
    });
    expect(huge).toContain("[cut here; the rest of the message is not shown]");
    expect(huge).toContain(`and ${500 - MAX_RESTORED_PATHS} more`);
    expect(huge.length).toBeLessThan(MAX_RESTORED_REQUEST_CHARS + BRIEF.length + 6_000);
  });

  test("a run with almost nothing to restore still restores the effort and the plan line", () => {
    const bare = renderRestoredState({ request: null, effort: "LOW", plan: null, work: null, guides: [], brief: null });
    expect(bare).toContain("<tau_effort>");
    expect(bare).toContain("No plan has been made");
    expect(bare).not.toContain("<user_request>");
  });
});

describe("the summary", () => {
  test("has five fixed sections, in order", () => {
    expect(SUMMARY_SECTIONS).toEqual(["Requests", "State of the work", "Decisions", "Problems", "Next"]);
    let at = -1;
    for (const section of SUMMARY_SECTIONS) {
      const next = SUMMARIZER_SYSTEM.indexOf(`## ${section}`);
      expect(next).toBeGreaterThan(at);
      at = next;
    }
  });

  test("the summarizer is told what is restored, so it does not spend space on it", () => {
    expect(SUMMARIZER_SYSTEM).toContain("restored for the agent separately, exactly and in full");
    for (const restored of ["request word for word", "plan", "files changed", "memory file", "design", "map of its files"]) {
      expect(SUMMARIZER_SYSTEM).toContain(restored);
    }
    // What a paraphrase loses first, it is told to keep.
    expect(SUMMARIZER_SYSTEM).toContain("things they said not to do");
    expect(SUMMARIZER_SYSTEM).toContain("tried and failed");
  });

  test("it is shown the user's words, not the blocks tau attached to them", () => {
    const [request] = shapeHistory(
      [
        { sequence: 1, role: "USER", type: "USER", jobId: null, content: "Make the header sticky." },
        { sequence: 2, role: "ASSISTANT", type: "RESULT", jobId: "job-1", content: { content: "Done.", tool_calls: null } },
      ],
      { currentJobId: "job-1", effortByJob: new Map([["job-1", "HIGH"]]), currentRequestNote: `${BRIEF}\n\n<tau_previous_plan>\nold plan\n</tau_previous_plan>` },
    );
    const sent = messageText(request!.param.content);
    expect(sent).toContain("<tau_app>");
    expect(sent).toContain("<tau_effort>");
    expect(withoutTauBlocks(sent)).toBe("Make the header sticky.");
    expect(withoutTauBlocks("No blocks here.")).toBe("No blocks here.");
  });

  test("a message with attachments is read as its text", () => {
    expect(messageText([{ type: "text", text: "See the screenshot." }, { type: "image_url", image_url: { url: "data:…" } }, { type: "text", text: "Fix that." }])).toBe("See the screenshot.\nFix that.");
    expect(messageText(null)).toBe("");
  });

  test("a summary is still recognised by its header", () => {
    expect(SUMMARY_HEADER).toBe("## Summary of earlier conversation\n");
  });
});

// ── Sub-agents ───────────────────────────────────────────────────────────────

const FRONTEND: AppKind = { generation: 2, hasServer: false, hasDb: false };
const FULLSTACK: AppKind = { generation: 2, hasServer: true, hasDb: true };
const OLD: AppKind = { generation: 1, hasServer: true, hasDb: false };

describe("a sub-agent is told about the app in front of it", () => {
  test("an app with no server is not sent to test an API", () => {
    const persona = subAgentPersona("verifier", FRONTEND);
    expect(persona).toContain("The app has no server and no API");
    expect(persona).not.toContain("port 3000");
    expect(persona).not.toContain("Each API route in scope");
    expect(persona).toContain("The page loads");
    expect(persona).toContain("a route added to a page but not to the router");
  });

  test("an app with a server and a database is", () => {
    const persona = subAgentPersona("verifier", FULLSTACK);
    expect(persona).toContain("served by Bun on port 3000");
    expect(persona).toContain("`server/db/schema.ts`");
    expect(persona).toContain("Each API route in scope");
  });

  test("it is given the command that really type-checks this app", () => {
    // On the base app the root tsconfig only references the others: a plain
    // `tsc --noEmit` compiles nothing and passes whatever the code says.
    expect(typeCheckCommand(FRONTEND)).toBe("bunx tsc -b");
    expect(appFacts(FRONTEND)).toContain("Plain `bunx tsc --noEmit` checks nothing in this app and always passes.");
    expect(subAgentPersona("verifier", FRONTEND)).toContain("Type check: `bunx tsc -b`.");
    expect(typeCheckCommand(OLD)).toBe("bunx tsc --noEmit");
  });

  test("where tau has handed over the app's memory, it is told so instead of told to read it", () => {
    for (const kind of SUB_AGENT_KINDS) {
      const now = subAgentPersona(kind, FRONTEND);
      expect(now).toContain("is given to you with your task");
      expect(now).not.toContain("Read `.tau/CONTEXT.md` first");
      expect(subAgentPersona(kind, OLD)).toContain("Read `.tau/CONTEXT.md` first");
    }
  });

  test("it knows tau's guides exist, and has the tool to read them", () => {
    const persona = subAgentPersona("debugger", FRONTEND);
    expect(persona).toContain("`read_doc`");
    expect(persona).toContain("- `components` —");
    expect(persona).toContain("built on Base UI, not Radix");
    const names = (kind: (typeof SUB_AGENT_KINDS)[number], generation: 1 | 2) =>
      toolsFor(kind, generation).map((t) => (t.type === "function" ? t.function.name : ""));
    expect(names("debugger", 2)).toContain("read_doc");
    expect(names("debugger", 1)).not.toContain("read_doc");
  });

  test("only the implementer can change files, whatever the app", () => {
    const names = (kind: (typeof SUB_AGENT_KINDS)[number]) =>
      toolsFor(kind, 2).map((t) => (t.type === "function" ? t.function.name : ""));
    for (const kind of ["explorer", "debugger", "verifier"] as const) {
      expect(names(kind)).not.toContain("edit_file");
      expect(names(kind)).not.toContain("create_file");
      expect(subAgentPersona(kind, FRONTEND)).toContain("NEVER edit, create, or delete any file");
    }
    expect(names("implementer")).toContain("edit_file");
  });

  test("every persona asks for a short report", () => {
    for (const kind of SUB_AGENT_KINDS) {
      expect(subAgentPersona(kind, FULLSTACK)).toContain("Keep the whole report under 500 words.");
    }
  });
});

describe("a sub-agent's context is bounded", () => {
  const read = (i: number): MessageParam[] => [
    {
      role: "assistant",
      content: null,
      tool_calls: [{ id: `call-${i}`, type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: `src/pages/Page${i}.tsx` }) } }],
    },
    { role: "tool", tool_call_id: `call-${i}`, content: JSON.stringify({ content: `// page ${i}\n${"const x = 1;\n".repeat(1_500)}` }) },
  ];
  const conversation = (reads: number): MessageParam[] => [
    { role: "system", content: "You are a read-only code investigator." },
    { role: "user", content: "How does routing work?" },
    ...Array.from({ length: reads }, (_, i) => read(i)).flat(),
  ];

  test("a small conversation is sent as it is", () => {
    const messages = conversation(2);
    const clearing = createClearingState();
    expect(boundedContext(messages, clearing, 100_000)).toEqual(messages);
    expect(clearing.replacements.size).toBe(0);
  });

  test("one that has grown past its mark has its oldest reads cleared, down to well below it", () => {
    const messages = conversation(30);
    const limit = 60_000;
    expect(estimateTokens(messages)).toBeGreaterThan(limit);
    const clearing = createClearingState();
    const sent = boundedContext(messages, clearing, limit);
    expect(estimateTokens(sent)).toBeLessThan(limit * 0.75);
    expect(clearing.replacements.size).toBeGreaterThan(0);
    // The newest reads are what it is working from, and are whole.
    expect(sent[sent.length - 1]).toEqual(messages[messages.length - 1]);
    // What was cleared says what it was, so it can be read again.
    expect(JSON.stringify(sent[3])).toContain("src/pages/Page0.tsx");
    // The conversation itself is untouched; only what is sent changes.
    expect(messages[3]!.content).toContain("const x = 1;");
  });

  test("what was cleared stays cleared, so the next turn sends the same prefix", () => {
    const messages = conversation(30);
    const clearing = createClearingState();
    const first = boundedContext(messages, clearing, 60_000);
    const cleared = new Map(clearing.replacements);
    const more: MessageParam[] = [...messages, { role: "user", content: "Carry on." }];
    const second = boundedContext(more, clearing, 60_000);
    expect(clearing.replacements).toEqual(cleared);
    expect(second.slice(0, first.length)).toEqual(first);
    // When it grows enough for another batch, nothing already cleared comes back.
    const third = boundedContext([...more, ...read(30), ...read(31), ...read(32)], clearing, 60_000);
    for (const [id, placeholder] of cleared) expect(clearing.replacements.get(id)).toBe(placeholder);
    expect(clearing.replacements.size).toBeGreaterThan(cleared.size);
    expect(third.slice(0, 10)).toEqual(first.slice(0, 10));
  });

  test("its share of the context is smaller than the main loop's and has a ceiling", () => {
    expect(subAgentContextTokens("deepseek-v4-pro")).toBeLessThanOrEqual(120_000);
    expect(subAgentContextTokens("deepseek-v4-pro")).toBeGreaterThan(4_000);
  });
});

describe("a sub-agent's report", () => {
  test("a short one is passed on as written", () => {
    expect(capReport("  **Overall: PASS**\n- ✓ type check\n")).toBe("**Overall: PASS**\n- ✓ type check");
  });

  test("a long one keeps its start and its end, and says it was cut", () => {
    const long = `**Root cause** — the route is missing.\n${"detail ".repeat(5_000)}\n**Risk** — none.`;
    const capped = capReport(long);
    expect(capped.length).toBeLessThan(MAX_REPORT_CHARS + 300);
    expect(capped.startsWith("**Root cause**")).toBe(true);
    expect(capped).toContain("**Risk** — none.");
    expect(capped).toContain("its middle was cut");
  });

  test("it is told how long it has, and to stop when the task is answered", () => {
    expect(turnBudgetNote(40)).toContain("at most 40 turns");
    expect(turnBudgetNote(40)).toContain("do not keep reading to be thorough");
  });

  test("one that ran out of turns is asked for its findings, not left mid-thought", () => {
    expect(FINAL_REPORT_NUDGE).toContain("Write your final report now");
    expect(FINAL_REPORT_NUDGE).toContain("what you did not get to");
  });
});
