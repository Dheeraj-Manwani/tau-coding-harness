import { describe, expect, test } from "bun:test";
import type OpenAI from "openai";
import {
  DOCS,
  DOC_NAMES,
  carriedGuides,
  docIndex,
  docsForPath,
  docsForTool,
  guideText,
  guidesIn,
  isDocName,
  readDoc,
  readTauTemplate,
} from "@/worker/agent/docs";
import { deliverDocs, docStateFrom } from "@/worker/agent/docs/delivery";
import {
  applyClearing,
  clearedResultText,
  createClearingState,
  isClearable,
  planClearing,
} from "@/worker/agent/context/clearing";
import { shapeHistory, type HistoryRow } from "@/worker/agent/context/history";
import { estimateTokens } from "@/worker/agent/context/tokens";
import { readDocTool } from "@/worker/agent/tools/functions/read-doc";
import { BASE_APP_TOOLS, TOOL_DEFINITIONS } from "@/worker/agent/tools/tools";
import { THEME_COLOR_TOKENS, NEUTRAL_THEME, buildThemeCss } from "@/worker/templates/theme";

type MessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam;

// A guide is the how-to for one part of a generated app's stack. It is kept out
// of the system prompt and reaches the model when that part is being worked on:
// returned by a setup tool, attached by tau to a tool result, or asked for with
// `read_doc`. These tests pin down the two things that make that safe
// (doc/CONTEXT_AND_MEMORY_PLAN.md §3):
//   - a guide arrives when its area is touched, without the model asking;
//   - it arrives once, and stays, across clearing and across requests.

const BIG = "x".repeat(2_000);

describe("the guides", () => {
  test("every guide loads and is a real document", () => {
    for (const name of DOC_NAMES) {
      const doc = readDoc(name);
      expect(doc.startsWith("# ")).toBe(true);
      expect(doc.length).toBeGreaterThan(500);
      expect(doc).not.toContain("\r");
    }
  });

  test("no guide sends the reader on to another one", () => {
    // One level of routing: the index points at guides, guides point at
    // nothing. A second hop is a second chance not to follow it.
    for (const name of DOC_NAMES) {
      expect(readDoc(name)).not.toContain("read_doc");
    }
  });

  test("each stays small enough to be handed over whole", () => {
    for (const name of DOC_NAMES) {
      expect(readDoc(name).length).toBeLessThan(6_000);
    }
  });

  test("every guide has an index line, and a way to arrive", () => {
    for (const name of DOC_NAMES) {
      expect(DOCS[name].when.length).toBeGreaterThan(20);
      expect(DOCS[name].when.startsWith("before ")).toBe(true);
    }
    expect(docIndex().split("\n")).toHaveLength(DOC_NAMES.length);
  });

  test("tools named as a trigger exist", () => {
    const known = new Set<string>([
      ...TOOL_DEFINITIONS.map((t) => t.function.name),
      ...BASE_APP_TOOLS.map((t) => t.function.name),
    ]);
    for (const name of DOC_NAMES) {
      for (const tool of DOCS[name].firstUseOf ?? []) expect(known.has(tool)).toBe(true);
    }
  });

  test("the theme guide describes the file the template actually writes", () => {
    const doc = readDoc("theme");
    const css = buildThemeCss(NEUTRAL_THEME);
    for (const block of [":root {", ".dark {", "@theme inline {"]) {
      expect(css).toContain(block);
      expect(doc).toContain(block.replace(" {", ""));
    }
    expect(css).toContain("--color-primary: var(--primary);");
    expect(doc).toContain("--color-primary: var(--primary)");
    // Every token family the guide explains is one the file declares.
    for (const token of ["background", "primary", "muted-foreground", "destructive", "chart-1", "chart-5"]) {
      expect(THEME_COLOR_TOKENS as readonly string[]).toContain(token);
      expect(doc).toContain(`\`${token}\``);
    }
  });

  test("the AI guide carries what an app needs to make the call", () => {
    const doc = readDoc("ai");
    for (const part of [
      "process.env.TAU_AI_URL",
      "process.env.TAU_API_KEY",
      "'X-Tau-Project': process.env.TAU_PROJECT_ID ?? ''",
      "data.text",
      "/chat/stream",
      "insufficient_credits",
      "tau-fast",
    ]) {
      expect(doc).toContain(part);
    }
    // Reading it is not the same as turning AI on.
    expect(doc).toContain("only after `enable_ai` has been called");
  });

  test("the assets and secrets guides keep the rules that lose work when missed", () => {
    expect(readDoc("assets")).toContain("Use `download_asset`, never `curl`");
    expect(readDoc("secrets")).toContain("never under a `VITE_` name");
    expect(readDoc("secrets")).toContain("That includes `.env`");
    expect(readDoc("github")).toContain("Never run `git` yourself");
  });

  test("tau.md is the prompt, not a guide", () => {
    expect(readTauTemplate()).toContain("{{guides}}");
    expect(isDocName("tau")).toBe(false);
  });
});

describe("guide markers", () => {
  test("a guide in a result can be found again", () => {
    const text = JSON.stringify({ success: true, guide: guideText("backend") });
    expect(guidesIn(text)).toEqual(["backend"]);
    expect(guidesIn(JSON.stringify({ a: guideText("theme"), b: guideText("assets") })).sort()).toEqual([
      "assets",
      "theme",
    ]);
  });

  test("ordinary text is not mistaken for one", () => {
    expect(guidesIn("the theme guide says…")).toEqual([]);
    expect(guidesIn("[tau guide: not-a-guide]")).toEqual([]);
    expect(guidesIn(JSON.stringify({ content: BIG }))).toEqual([]);
  });

  test("carriedGuides returns the guides and nothing of the result around them", () => {
    const content = JSON.stringify({
      content: "body { color: red }",
      guideNote: "A guide is attached below",
      attachedGuide: guideText("theme"),
    });
    expect(carriedGuides(content)).toBe(guideText("theme"));
    expect(carriedGuides(JSON.stringify({ content: BIG }))).toBe("");
    expect(carriedGuides("not json [tau guide: theme]")).toBe("");
  });
});

describe("what a path or a tool attaches", () => {
  test("a file is matched however the model spells its path", () => {
    for (const p of ["src/index.css", "./src/index.css", "/home/user/app/src/index.css", " src/index.css "]) {
      expect(docsForPath(p)).toEqual(["theme"]);
    }
  });

  test("the server and its database are separate guides", () => {
    expect(docsForPath("server/index.ts")).toEqual(["backend"]);
    expect(docsForPath("server/routes/users.ts")).toEqual(["backend"]);
    expect(docsForPath("server/db/schema.ts")).toEqual(["database"]);
    expect(docsForPath("server/db/client.ts")).toEqual(["database"]);
  });

  test("most files attach nothing", () => {
    for (const p of ["src/App.tsx", "src/components/ui/button.tsx", "package.json", "src/server/x.ts", "src/index.css.bak"]) {
      expect(docsForPath(p)).toEqual([]);
    }
  });

  test("tools that have a guide", () => {
    expect(docsForTool("search_images")).toEqual(["assets"]);
    expect(docsForTool("request_secret")).toEqual(["secrets"]);
    expect(docsForTool("push_to_github")).toEqual(["github"]);
    expect(docsForTool("create_github_issue")).toEqual(["github"]);
    expect(docsForTool("read_file")).toEqual([]);
  });

  test("every guide has something that brings it without being asked", () => {
    // `read_doc` alone is the route a model skips. `ai` is the one exception:
    // `enable_ai` returns it, and it is no use before that call.
    for (const name of DOC_NAMES) {
      if (name === "ai") continue;
      const spec = DOCS[name];
      const returnedBySetupTool = spec.when.includes("Returned by `add_");
      expect(
        !!spec.covers || (spec.firstUseOf?.length ?? 0) > 0 || returnedBySetupTool,
      ).toBe(true);
    }
  });
});

describe("deliverDocs", () => {
  const fresh = () => docStateFrom([]);

  test("opening a covered file attaches its guide to that result", () => {
    const state = fresh();
    const { output, delivered } = deliverDocs(
      state,
      "read_file",
      { path: "src/index.css" },
      { content: ":root {}" },
    );
    const out = output as Record<string, string>;
    expect(out.content).toBe(":root {}");
    expect(out.attachedGuide).toBe(guideText("theme"));
    expect(out.guideNote).toContain("because you opened src/index.css");
    expect(out.guideNote).not.toContain("just wrote");
    expect(delivered).toEqual([{ name: "theme", via: "path", repeat: false }]);
    expect(state.loaded.has("theme")).toBe(true);
  });

  test("a guide that arrives with a write says to check what was written", () => {
    const { output } = deliverDocs(
      fresh(),
      "create_file",
      { path: "server/routes/users.ts", content: "…" },
      { success: true },
    );
    const out = output as Record<string, string>;
    expect(out.attachedGuide).toBe(guideText("backend"));
    expect(out.guideNote).toContain("because you changed server/routes/users.ts");
    expect(out.guideNote).toContain("Check what you just wrote against it");
  });

  test("attaches once: the second touch returns the result untouched", () => {
    const state = fresh();
    deliverDocs(state, "read_file", { path: "src/index.css" }, { content: "a" });
    const original = { success: true };
    const second = deliverDocs(state, "edit_file", { path: "src/index.css" }, original);
    expect(second.output).toBe(original);
    expect(second.delivered).toEqual([]);
  });

  test("the first use of a tool with a guide attaches it", () => {
    const state = fresh();
    const first = deliverDocs(state, "search_images", { query: "cat" }, { images: [] });
    expect((first.output as Record<string, string>).attachedGuide).toBe(guideText("assets"));
    expect((first.output as Record<string, string>).guideNote).toContain("first time `search_images` was used");
    expect((first.output as Record<string, string>).guideNote).not.toContain("just wrote");
    expect(first.delivered).toEqual([{ name: "assets", via: "first_use", repeat: false }]);
    const again = deliverDocs(state, "search_images", { query: "dog" }, { images: [] });
    expect(again.delivered).toEqual([]);
  });

  test("a guide a setup tool returned is not attached again by a path", () => {
    const state = fresh();
    const setup = deliverDocs(state, "add_database", {}, {
      success: true,
      guide: guideText("database"),
      backendGuide: guideText("backend"),
    });
    expect(setup.delivered.map((d) => [d.name, d.via]).sort()).toEqual([
      ["backend", "tool"],
      ["database", "tool"],
    ]);
    for (const path of ["server/db/schema.ts", "server/index.ts"]) {
      const r = deliverDocs(state, "edit_file", { path }, { success: true });
      expect(r.delivered).toEqual([]);
      expect(r.output).toEqual({ success: true });
    }
  });

  test("asking with read_doc counts, and a second ask is marked a repeat", () => {
    const state = fresh();
    const first = deliverDocs(state, "read_doc", { name: "github" }, readDocTool({ name: "github" }));
    expect(first.delivered).toEqual([{ name: "github", via: "pull", repeat: false }]);
    const second = deliverDocs(state, "read_doc", { name: "github" }, readDocTool({ name: "github" }));
    expect(second.delivered).toEqual([{ name: "github", via: "pull", repeat: true }]);
  });

  test("nothing is attached to a failed call, so the retry still gets it", () => {
    const state = fresh();
    const failed = deliverDocs(state, "read_file", { path: "server/db/schema.ts" }, { error: "No such file" });
    expect(failed.output).toEqual({ error: "No such file" });
    expect(state.loaded.size).toBe(0);
    const retry = deliverDocs(state, "read_file", { path: "server/db/schema.ts" }, { content: "x" });
    expect(retry.delivered).toEqual([{ name: "database", via: "path", repeat: false }]);
  });

  test("other tools' paths do not count as working on a file", () => {
    const state = fresh();
    for (const tool of ["list_dir", "grep", "delete_file"]) {
      expect(deliverDocs(state, tool, { path: "server/db" }, { entries: [] }).delivered).toEqual([]);
    }
  });

  test("leaves a result that is not an object alone", () => {
    const state = fresh();
    expect(deliverDocs(state, "read_file", { path: "src/index.css" }, "text").output).toBe("text");
    expect(deliverDocs(state, "read_file", { path: "src/index.css" }, null).output).toBe(null);
  });
});

describe("read_doc", () => {
  test("returns the guide that was asked for", () => {
    expect(readDocTool({ name: "theme" })).toEqual({ name: "theme", guide: guideText("theme") });
  });

  test("an unknown name is an error that lists the real ones", () => {
    const out = readDocTool({ name: "styling" }) as { error: string };
    expect(out.error).toContain('"styling"');
    for (const name of DOC_NAMES) expect(out.error).toContain(name);
    expect(readDocTool({})).toHaveProperty("error");
    expect(readDocTool(null)).toHaveProperty("error");
  });

  test("the tool offers exactly the guides that exist", () => {
    const tool = BASE_APP_TOOLS.find((t) => t.function.name === "read_doc")!;
    expect("name" in tool.function.parameters.properties).toBe(true);
    const props = tool.function.parameters.properties as { name: { enum: readonly string[] } };
    expect([...props.name.enum]).toEqual([...DOC_NAMES]);
  });
});

// ── A guide outlives the result that carried it ──────────────────────────────

const readCss = { name: "read_file", args: { path: "src/index.css" } };
const cssWithGuide = JSON.stringify({
  content: BIG,
  guideNote: "A guide is attached below because you opened src/index.css.",
  attachedGuide: guideText("theme"),
});

describe("clearing a result that carries a guide", () => {
  test("drops the result and keeps the guide", () => {
    const cleared = clearedResultText(readCss, cssWithGuide);
    expect(cleared.startsWith("[Old result cleared to save context: read_file src/index.css.")).toBe(true);
    expect(cleared.endsWith(guideText("theme"))).toBe(true);
    expect(cleared).not.toContain(BIG);
    expect(cleared.length).toBeLessThan(cssWithGuide.length);
    // Still found, so it is not attached a second time.
    expect(guidesIn(cleared)).toEqual(["theme"]);
  });

  test("a result without one is cleared exactly as before", () => {
    expect(clearedResultText(readCss, JSON.stringify({ content: BIG }))).toBe(clearedResultText(readCss));
  });

  test("a small file is not cleared just because a guide made its result long", () => {
    const small = JSON.stringify({ content: "a{}", attachedGuide: guideText("theme") });
    expect(small.length).toBeGreaterThan(300);
    expect(isClearable(readCss, small)).toBe(false);
    expect(isClearable(readCss, cssWithGuide)).toBe(true);
  });

  function runWithGuideThenReads(n: number): MessageParam[] {
    const msgs: MessageParam[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "go" },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "css", type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: "src/index.css" }) } }],
      },
      { role: "tool", tool_call_id: "css", content: cssWithGuide },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "db", type: "function", function: { name: "add_database", arguments: "{}" } }],
      },
      // Not a clearable tool, and far over the size that gets cut in the middle.
      { role: "tool", tool_call_id: "db", content: JSON.stringify({ success: true, pad: BIG.repeat(6), guide: guideText("database") }) },
    ];
    for (let i = 0; i < n; i++) {
      msgs.push({
        role: "assistant",
        content: null,
        tool_calls: [{ id: `r${i}`, type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: `src/f${i}.ts` }) } }],
      });
      msgs.push({ role: "tool", tool_call_id: `r${i}`, content: BIG });
    }
    return msgs;
  }

  test("a batch during a run clears the read and leaves both guides whole", () => {
    const msgs = runWithGuideThenReads(20);
    const state = createClearingState();
    planClearing(msgs, state, {
      tokensNow: estimateTokens(msgs),
      targetTokens: 0, // clear everything that may be cleared
      tokensPerChar: 1 / 4,
      maxToolResultTokens: 2_000,
    });
    const after = applyClearing(msgs, state);

    const css = after[3]!.content as string;
    expect(css).toBe(clearedResultText(readCss, cssWithGuide));
    expect(css).toContain(guideText("theme"));

    // The setup tool's result is oversized, but cutting its middle out would
    // cut the guide's middle out.
    expect(after[5]!.content).toBe(msgs[5]!.content as string);

    expect([...docStateFrom(after).loaded].sort()).toEqual(["database", "theme"]);
  });

  test("the next request clears it to the same bytes", () => {
    const rows: HistoryRow[] = [
      { sequence: 1, role: "USER", type: "USER", jobId: null, content: "make it green" },
      {
        sequence: 2,
        role: "ASSISTANT",
        type: "TOOL_REQ",
        jobId: "job-1",
        content: {
          content: null,
          tool_calls: [{ id: "css", type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: "src/index.css" }) } }],
        },
      },
      { sequence: 3, role: "USER", type: "TOOL_RES", jobId: "job-1", content: [{ tool_call_id: "css", content: cssWithGuide }] },
      { sequence: 4, role: "ASSISTANT", type: "RESULT", jobId: "job-1", content: { content: "Done.", tool_calls: null } },
      { sequence: 5, role: "USER", type: "USER", jobId: null, content: "now add a table" },
    ];
    const during = shapeHistory(rows.slice(0, 3), { currentJobId: "job-1" });
    const after = shapeHistory(rows, { currentJobId: "job-2" });
    const tool = (entries: typeof after) =>
      entries.find((e) => e.param.role === "tool")!.param.content as string;

    // In its own request the read is whole; in the next it is cleared, guide kept.
    expect(tool(during)).toBe(cssWithGuide);
    expect(tool(after)).toBe(clearedResultText(readCss, cssWithGuide));

    // So the follow-up starts with the guide already in the conversation, and
    // touching the file again attaches nothing.
    const state = docStateFrom(after.map((e) => e.param));
    expect([...state.loaded]).toEqual(["theme"]);
    expect(deliverDocs(state, "edit_file", { path: "src/index.css" }, { success: true }).delivered).toEqual([]);
    // A guide that was never loaded still attaches.
    expect(
      deliverDocs(state, "read_file", { path: "server/db/schema.ts" }, { content: "x" }).delivered,
    ).toEqual([{ name: "database", via: "path", repeat: false }]);
  });

  test("after a summary the guide is gone, so it is attached again", () => {
    // What the loop does when the context is summarized: the old results are
    // replaced by a summary, and the state is read off what is left.
    const summarized: MessageParam[] = [
      { role: "system", content: "sys" },
      { role: "system", content: "Summary of earlier work: the theme was changed to green." },
      { role: "user", content: "now make it blue" },
    ];
    const state = docStateFrom(summarized);
    expect(state.loaded.size).toBe(0);
    expect(
      deliverDocs(state, "read_file", { path: "src/index.css" }, { content: "x" }).delivered,
    ).toEqual([{ name: "theme", via: "path", repeat: false }]);
  });
});
