import { describe, expect, test } from "bun:test";
import { patchPreferencesSchema, readPreferences } from "@/api/schemas/preferences.schema";
import { designConfigSchema, messageSchema, updateProjectSchema } from "@/api/schemas/project.schema";
import { CLEARABLE_TOOLS } from "@/worker/agent/context/clearing";
import { shapeHistory } from "@/worker/agent/context/history";
import {
  MAX_EXCERPT_CHARS,
  MAX_FOCUS_CHARS,
  MAX_HISTORY_MATCHES,
  MAX_NEIGHBOUR_CHARS,
  excerptAround,
  likePattern,
  queryTerms,
  rowText,
  speakerOf,
  toConversation,
  toMatches,
  type StoredRow,
} from "@/worker/agent/context/lookup";
import { renderRestoredState } from "@/worker/agent/context/restore";
import {
  MAX_PROJECT_INSTRUCTIONS_CHARS,
  MAX_USER_INSTRUCTIONS_CHARS,
  renderStanding,
  userInstructionsOf,
} from "@/worker/agent/context/standing";
import {
  SUMMARY_FOOTER,
  SUMMARY_HEADER,
  summaryMessage,
  summaryOf,
  withoutTauBlocks,
} from "@/worker/agent/context/summarize";
import { toolsFor } from "@/worker/agent/tools/sub-agents/tool-sets";
import { TOOL_DEFINITIONS } from "@/worker/agent/tools/tools";

// Three things a project remembers that are not in its code: what the user
// told tau to do every time, what was said earlier, and how the user likes
// their apps to look (doc/CONTEXT_AND_MEMORY_PLAN.md §7, items 10 and 11).

describe("standing instructions", () => {
  test("nothing written is nothing attached", () => {
    expect(renderStanding({ user: null, project: null })).toBeNull();
    expect(renderStanding({ user: "   ", project: "\n" })).toBeNull();
  });

  test("the user's own words, for all their projects", () => {
    const note = renderStanding({ user: "Write interface copy in British English.", project: null })!;
    expect(note.startsWith("<tau_instructions>\n")).toBe(true);
    expect(note.endsWith("\n</tau_instructions>")).toBe(true);
    expect(note).toContain("<for_all_projects>\nWrite interface copy in British English.\n</for_all_projects>");
    expect(note).not.toContain("<for_this_project>");
    expect(note).toContain("apply to every request, including this one, unless the request itself says otherwise");
  });

  test("a project's own come second, and win where the two disagree", () => {
    const note = renderStanding({ user: "Dark mode.", project: "This one is light." })!;
    expect(note.indexOf("<for_all_projects>")).toBeLessThan(note.indexOf("<for_this_project>"));
    expect(note).toContain("For this project — where the two disagree, this wins:");
    // With nothing to disagree with, nothing is said about winning.
    expect(renderStanding({ user: null, project: "This one is light." })).toContain("For this project:\n<for_this_project>");
  });

  test("they are the user's to edit, not the agent's", () => {
    const note = renderStanding({ user: "x", project: null })!;
    expect(note).toContain("They are not yours to edit");
    expect(note).toContain("you do not need to record them in the app's memory");
  });

  test("each has a length it cannot exceed", () => {
    const note = renderStanding({ user: "u".repeat(9_000), project: "p".repeat(9_000) })!;
    expect(note.match(/u/g)!.length).toBeLessThanOrEqual(MAX_USER_INSTRUCTIONS_CHARS + 60);
    expect(note.match(/p{100,}/)![0]).toHaveLength(MAX_PROJECT_INSTRUCTIONS_CHARS);
  });

  test("they are read out of a user's preferences, whatever else is in there", () => {
    expect(userInstructionsOf({ reduceMotion: true, instructions: "  Prices in pounds.  " })).toBe("Prices in pounds.");
    expect(userInstructionsOf({ instructions: 7 })).toBeNull();
    expect(userInstructionsOf({ instructions: "" })).toBeNull();
    expect(userInstructionsOf(null)).toBeNull();
  });

  test("they are put back after a summary, ahead of the app's own memory", () => {
    const standing = renderStanding({ user: "Prices in pounds.", project: null });
    const restored = renderRestoredState({
      request: "Add a checkout page.", effort: "HIGH", plan: null, work: null, guides: [],
      standing, brief: "<tau_app>\nthe app\n</tau_app>",
    });
    expect(restored).toContain("Prices in pounds.");
    expect(restored.indexOf("<tau_instructions>")).toBeLessThan(restored.indexOf("<tau_app>"));
  });

  test("the summarizer is not shown them: they are restored, not paraphrased", () => {
    const standing = renderStanding({ user: "Prices in pounds.", project: null })!;
    expect(withoutTauBlocks(`Add a checkout page.\n\n${standing}`)).toBe("Add a checkout page.");
  });
});

describe("storing them", () => {
  test("a user's instructions and default look are preferences like any other", () => {
    expect(patchPreferencesSchema.safeParse({ instructions: "Prices in pounds." }).success).toBe(true);
    expect(patchPreferencesSchema.safeParse({ instructions: "" }).success).toBe(true);
    expect(patchPreferencesSchema.safeParse({ instructions: "x".repeat(MAX_USER_INSTRUCTIONS_CHARS + 1) }).success).toBe(false);
    expect(patchPreferencesSchema.safeParse({ instructions: "a\0b" }).success).toBe(false);
    expect(patchPreferencesSchema.safeParse({ defaultDesign: { style: "neon", accent: "#d63cff", dials: { motion: 8 } } }).success).toBe(true);
    expect(patchPreferencesSchema.safeParse({ defaultDesign: null }).success).toBe(true);
    expect(patchPreferencesSchema.safeParse({ defaultDesign: { style: "vaporwave" } }).success).toBe(false);
    // A default look is not a place to keep a file.
    expect(patchPreferencesSchema.safeParse({ defaultDesign: { designMd: "# Mine" } }).success).toBe(false);
  });

  test("what is read back is tidied, and one bad value costs only itself", () => {
    expect(
      readPreferences({ reduceMotion: true, instructions: "  Prices in pounds.  ", defaultDesign: { style: "neon", accent: "#D63CFF", fonts: "exo" } }),
    ).toEqual({ reduceMotion: true, instructions: "Prices in pounds.", defaultDesign: { style: "neon", accent: "#d63cff", fonts: "exo" } });
    // Cleared values read as not set.
    expect(readPreferences({ instructions: "", defaultDesign: null })).toEqual({});
    expect(readPreferences({ lastEffort: "HIGH", instructions: 7, defaultDesign: { style: "vaporwave" } })).toEqual({ lastEffort: "HIGH" });
    // A pairing that does not belong to the style is dropped, not the style.
    expect(readPreferences({ defaultDesign: { style: "soft", fonts: "exo" } })).toEqual({ defaultDesign: { style: "soft" } });
    // An imported file never comes back out of a default, however it got in.
    expect(readPreferences({ defaultDesign: { style: "soft", designMd: "# Mine" } })).toEqual({ defaultDesign: { style: "soft" } });
  });

  test("a project's instructions are edited with its name and description", () => {
    expect(updateProjectSchema.safeParse({ instructions: "The pricing page is signed off." }).success).toBe(true);
    // An empty string is how they are cleared.
    expect(updateProjectSchema.parse({ instructions: "  " })).toEqual({ instructions: "" });
    expect(updateProjectSchema.safeParse({ instructions: "x".repeat(MAX_PROJECT_INSTRUCTIONS_CHARS + 1) }).success).toBe(false);
    expect(updateProjectSchema.safeParse({}).success).toBe(false);
  });

  test("a new project can say 'no look chosen' and 'no default either' apart", () => {
    // Left out: the user's default applies. Present but empty: tau decides.
    expect(messageSchema.parse({ message: "Build a site" }).design).toBeUndefined();
    expect(messageSchema.parse({ message: "Build a site", design: {} }).design).toEqual({});
    expect(designConfigSchema.safeParse({}).success).toBe(true);
  });
});

// ── Looking something up ─────────────────────────────────────────────────────

const at = (day: number) => new Date(Date.UTC(2026, 9, day, 12));
const user = (sequence: number, text: string, day = 1): StoredRow => ({ sequence, role: "USER", type: "USER", content: text, createdAt: at(day) });
const assistant = (sequence: number, text: string | null, calls: [string, unknown][] = [], day = 1): StoredRow => ({
  sequence, role: "ASSISTANT", type: "RESULT", createdAt: at(day),
  content: { content: text, tool_calls: calls.map(([name, args], i) => ({ id: `c${sequence}-${i}`, type: "function", function: { name, arguments: JSON.stringify(args) } })) },
});
const results = (sequence: number, ...bodies: string[]): StoredRow => ({
  sequence, role: "ASSISTANT", type: "TOOL_RES", createdAt: at(1),
  content: bodies.map((content, i) => ({ tool_call_id: `c${i}`, content })),
});

describe("the history lookup tool", () => {
  const tool = TOOL_DEFINITIONS.find((t) => t.function.name === "search_history")!;

  test("is offered to the agent, and says what it is for and what it is not", () => {
    expect(tool).toBeDefined();
    expect(tool.function.description).toContain("including what a summary replaced");
    expect(tool.function.description).toContain("It does not search file contents or command output");
    expect(Object.keys(tool.function.parameters.properties)).toEqual(["query", "around", "from"]);
    expect(tool.function.parameters.required).toEqual([]);
  });

  test("its results can be cleared: the same search gives the same answer", () => {
    expect(CLEARABLE_TOOLS.has("search_history")).toBe(true);
  });

  test("a sub-agent on the base app gets it too: the project's conversation is stored whoever is working", () => {
    // Phase 7 of the plan (S2). A sub-agent has no conversation of its own, but
    // the user's earlier requests are the project's, and its task cannot repeat all of them.
    for (const kind of ["explorer", "debugger", "verifier", "implementer"] as const) {
      expect(toolsFor(kind, 2).map((t) => (t.type === "function" ? t.function.name : ""))).toContain("search_history");
      expect(toolsFor(kind, 1).map((t) => (t.type === "function" ? t.function.name : ""))).not.toContain("search_history");
    }
  });

  test("a summary says the messages behind it can still be had", () => {
    const message = summaryMessage("## Requests\n1. A bakery site.");
    expect(message.startsWith(SUMMARY_HEADER)).toBe(true);
    expect(message.endsWith(SUMMARY_FOOTER)).toBe(true);
    expect(SUMMARY_FOOTER).toContain("`search_history`");
    // The summary itself comes back out unchanged, to be folded into the next.
    expect(summaryOf(message)).toBe("## Requests\n1. A bakery site.");
    expect(summaryOf(`${SUMMARY_HEADER}an older summary, stored without the note`)).toBe("an older summary, stored without the note");
    // The same at load, for a project summarized in an earlier request.
    const [first] = shapeHistory([], { checkpointSummary: "## Requests\n1. A bakery site." });
    expect(first!.param.content).toBe(message);
    expect(renderRestoredState({ request: null, effort: "LOW", plan: null, work: null, guides: [], brief: null })).toContain("`search_history` finds it");
  });
});

describe("what a search looks for", () => {
  test("the words of the query, tidied; a quoted query is one phrase", () => {
    expect(queryTerms("Pricing  page, STRIPE")).toEqual(["pricing", "page", "stripe"]);
    expect(queryTerms('"do not change the pricing page"')).toEqual(["do not change the pricing page"]);
    expect(queryTerms("a I x")).toEqual([]);
    expect(queryTerms("one two three four five six seven eight")).toHaveLength(6);
    expect(queryTerms("the the the")).toEqual(["the"]);
    expect(queryTerms(42)).toEqual([]);
  });

  test("a word is matched as written, even if it looks like a pattern", () => {
    expect(likePattern("pricing")).toBe("%pricing%");
    expect(likePattern("100%")).toBe("%100\\%%");
    expect(likePattern("snake_case")).toBe("%snake\\_case%");
    expect(likePattern("a\\b")).toBe("%a\\\\b%");
  });
});

describe("what a stored message reads as", () => {
  test("what the user said, attachments and all", () => {
    expect(rowText(user(1, "Make the header sticky."))).toBe("Make the header sticky.");
    expect(rowText({ role: "USER", type: "USER", content: [{ type: "text", text: "See this." }, { type: "image_url", image_url: { url: "data:…" } }] })).toBe("See this.");
  });

  test("what the agent said and what it did", () => {
    const text = rowText(assistant(2, "Adding the page.", [["create_file", { path: "src/pages/Pricing.tsx", content: "x".repeat(5_000) }], ["run_command", { command: "bun run build" }]]));
    expect(text.split("\n")[0]).toBe("Adding the page.");
    expect(text).toContain("[called create_file(");
    expect(text).toContain("src/pages/Pricing.tsx");
    expect(text).toContain('[called run_command({"command":"bun run build"})]');
    // A file body is cut: the lookup is for what was done, not for the file.
    expect(text.length).toBeLessThan(1_200);
    expect(rowText(assistant(3, null))).toBe("");
  });

  test("a tool result is described, not quoted", () => {
    const text = rowText(results(4, "a".repeat(4_000), "b".repeat(1_000)));
    expect(text).toContain("2 tool results, 5,000 characters");
    expect(text).toContain("run the tool again");
    expect(text).not.toContain("aaaa");
  });

  test("an edit the user made by hand is said to be one", () => {
    const row = { role: "USER", type: "USER_EDIT", content: { path: "src/App.tsx", linesAdded: 3, linesRemoved: 1 } };
    expect(rowText(row)).toBe("[the user edited src/App.tsx by hand: +3/-1 lines]");
    expect(speakerOf(row)).toBe("user");
    expect(speakerOf({ role: "ASSISTANT", type: "TOOL_RES" })).toBe("tool");
  });
});

describe("what a search returns", () => {
  const long = `${"Earlier talk about the header. ".repeat(40)}The pricing page is signed off by legal, do not change it. ${"Later talk about the footer. ".repeat(40)}`;

  test("a short excerpt around the match, cut at words", () => {
    const excerpt = excerptAround(long, ["signed off"]);
    expect(excerpt.length).toBeLessThanOrEqual(MAX_EXCERPT_CHARS + 2);
    expect(excerpt).toContain("The pricing page is signed off by legal, do not change it.");
    expect(excerpt.startsWith("…")).toBe(true);
    expect(excerpt.endsWith("…")).toBe(true);
    expect(excerpt.startsWith("…arlier") || excerpt.startsWith("…alk")).toBe(false);
    // A short message is given whole.
    expect(excerptAround("Make the header   sticky.", ["sticky"])).toBe("Make the header sticky.");
  });

  test("each match says who said it, when, and its number", () => {
    const matches = toMatches([assistant(9, "Left the pricing page alone, as asked.", [], 3), user(4, long, 2)], ["pricing"]);
    expect(matches).toEqual([
      { n: 9, from: "assistant", on: "2026-10-03", excerpt: "Left the pricing page alone, as asked." },
      { n: 4, from: "user", on: "2026-10-02", excerpt: expect.stringContaining("pricing page is signed off") },
    ]);
  });

  test("a match inside a file the agent wrote is still found and excerpted", () => {
    const row = assistant(5, null, [["create_file", { path: "src/data/legal.ts", content: `${"// filler\n".repeat(200)}export const NOTE = "signed off by legal";\n` }]]);
    const [match] = toMatches([row], ["signed off by legal"]);
    expect(match!.excerpt).toContain("signed off by legal");
  });

  test("a search does not find itself", () => {
    // Seen in the first real run: the newest match for a query was the call
    // that made it, and a second search found only the first.
    const lookups = assistant(12, null, [["search_history", { query: "pricing legal" }]]);
    expect(toMatches([lookups, user(4, "The pricing page is signed off by legal.")], ["pricing", "legal"]).map((m) => m.n)).toEqual([4]);
    // Nor is a lookup part of the conversation when reading around it.
    expect(toConversation([lookups, user(13, "Thanks.")]).map((m) => m.n)).toEqual([13]);
    // What the agent said in the same turn still counts.
    const spoke = assistant(14, "Checking what was agreed about pricing.", [["search_history", { query: "pricing" }]]);
    expect(toMatches([spoke], ["pricing"])).toEqual([
      { n: 14, from: "assistant", on: "2026-10-01", excerpt: "Checking what was agreed about pricing." },
    ]);
  });

  test("where it was said comes before files it merely appears in", () => {
    const file = (n: number) => assistant(n, null, [["create_file", { path: `src/pages/Page${n}.tsx`, content: `${"const filler = 1\n".repeat(60)}// the pricing table\n` }]]);
    const rows = [file(30), file(28), file(26), assistant(20, "Left the pricing page alone, as asked."), file(18), user(4, "Do not touch the pricing page.")];
    const matches = toMatches(rows, ["pricing"]);
    expect(matches.map((m) => m.n)).toEqual([20, 4, 30, 28, 26, 18]);
    // A file match names the file and shows the line, not the top of the file.
    expect(matches[2]!.excerpt).toContain("src/pages/Page30.tsx");
    expect(matches[2]!.excerpt).toContain("the pricing table");
    // A call that is about the thing — its path, a command — is a direct match.
    const about = assistant(22, null, [["edit_file", { path: "src/pages/Pricing.tsx", old_string: "a", new_string: "b" }]]);
    expect(toMatches([file(30), about], ["pricing"]).map((m) => m.n)).toEqual([22, 30]);
  });

  test("a call's short values are kept whole; only a long one is cut", () => {
    const todos = Array.from({ length: 12 }, (_, i) => `Build part ${i + 1} of the pricing flow`);
    const plan = assistant(1, null, [["create_plan", { name: "Shop", description: "d".repeat(900), todos }]]);
    const [said] = toConversation([plan]);
    for (const todo of todos) expect(said!.text).toContain(todo);
    expect(said!.text).toContain("600 more characters]");
  });

  test("the message asked for comes back nearly whole, its neighbours briefly", () => {
    // Seen in a real run: a 318-character value cut at 300 cost five more
    // searches to recover the last eighteen characters.
    const brief = `It should feel warm and calm. ${"Linen, enamel, worn wood. ".repeat(40)}Metric-first measurements throughout.`;
    const rows = [
      assistant(1, null, [["provision_sandbox", { brief }]]),
      assistant(2, null, [["create_file", { path: "src/a.ts", content: brief }]]),
    ];
    const [asked, neighbour] = toConversation(rows, 1);
    expect(asked!.text).toContain("Metric-first measurements throughout.");
    expect(neighbour!.text).not.toContain("Metric-first measurements throughout.");
    expect(neighbour!.text).toContain("more characters]");
    // Even so, there is a limit.
    const huge = toConversation([user(3, "z".repeat(40_000))], 3)[0]!;
    expect(huge.text.length).toBeLessThan(MAX_FOCUS_CHARS + 60);
  });

  test("at most a handful, and never tool results", () => {
    const many = Array.from({ length: 20 }, (_, i) => user(100 - i, `pricing note ${i}`));
    expect(toMatches(many, ["pricing"])).toHaveLength(MAX_HISTORY_MATCHES);
    expect(toMatches([results(7, "pricing in a file")], ["pricing"])).toEqual([]);
  });

  test("reading around a message gives the conversation in order, each part bounded", () => {
    const conversation = toConversation([
      results(6, "x".repeat(900)),
      user(4, "Make the header sticky."),
      assistant(5, "On it.", [["edit_file", { path: "src/components/Header.tsx", old_string: "a", new_string: "b" }]]),
      user(7, "y".repeat(5_000)),
    ]);
    expect(conversation.map((m) => [m.n, m.from])).toEqual([[4, "user"], [5, "assistant"], [6, "tool"], [7, "user"]]);
    expect(conversation[1]!.text).toContain("src/components/Header.tsx");
    expect(conversation[2]!.text).toContain("1 tool result, 900 characters");
    expect(conversation[3]!.text.length).toBeLessThan(MAX_NEIGHBOUR_CHARS + 60);
    expect(conversation[3]!.text).toContain("more characters]");
  });
});
