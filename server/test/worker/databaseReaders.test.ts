import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "@/lib/prisma";
import { loadStanding } from "@/worker/agent/context/standing";
import { loadPlan, unfinishedPlanNote } from "@/worker/agent/plan";
import { searchHistory } from "@/worker/agent/tools/functions/search-history";

// The parts of the agent that read Postgres were covered only by real builds:
// the history search, the standing instructions, the plan of a job and of the
// request before. These run them against a real database, in rows of their own
// that are removed afterwards. Where there is no database they are skipped, as
// on a machine that has only run `bun install`.

const dbUp = await prisma
  .$queryRaw`SELECT 1`
  .then(() => true)
  .catch(() => false);
const searchable = dbUp
  ? await prisma
      .$queryRaw`SELECT 1 FROM pg_proc WHERE proname = 'tau_message_text'`
      .then((rows) => (rows as unknown[]).length > 0)
      .catch(() => false)
  : false;

const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let userId = "";
let projectId = "";
let otherProjectId = "";

// What a person said is stored as a string; what the agent said, as an object.
const text = (content: string) => content;
const saidBy = (content: string) => ({ content });
let sequence = 0;
async function say(project: string, role: "USER" | "ASSISTANT", type: string, content: unknown, jobId?: string) {
  return prisma.message.create({
    data: { projectId: project, role, type: type as never, content: content as never, sequence: ++sequence, ...(jobId ? { jobId } : {}) },
  });
}

describe.skipIf(!dbUp)("what the agent reads from the database", () => {
  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `reader-${stamp}@test.local`, preferences: { instructions: "I prefer dark interfaces." } },
    });
    userId = user.id;
    const project = await prisma.project.create({
      data: { name: "Readers", userId, instructions: "The logo is always green." },
    });
    projectId = project.id;
    otherProjectId = (await prisma.project.create({ data: { name: "Other", userId } })).id;

    await say(projectId, "USER", "USER", text('Make the pricing page use "dark" tones\nand a bigger headline'));
    await say(projectId, "ASSISTANT", "RESULT", saidBy("Done: the pricing page is dark now."));
    await say(projectId, "USER", "USER", text("Add a table with the measurements of each frame."));
    await say(projectId, "ASSISTANT", "TOOL_REQ", {
      content: null,
      tool_calls: [
        {
          id: "c1",
          type: "function",
          function: { name: "create_file", arguments: JSON.stringify({ path: "src/Pricing.tsx", content: "export const headline = 'Pricing and headline'" }) },
        },
      ],
    });
    await say(projectId, "USER", "TOOL_RES", [{ content: "the headline appears in this tool result only" }]);
    await say(projectId, "USER", "USER", text("Use a calmer headline please."));
    await say(projectId, "USER", "USER", text("Put the zebrafish facts on the about page."));
    await say(projectId, "ASSISTANT", "TOOL_REQ", {
      content: null,
      tool_calls: [
        {
          id: "c2",
          type: "function",
          function: { name: "create_file", arguments: JSON.stringify({ path: "src/About.tsx", content: `${"// filler ".repeat(60)} zebrafish` }) },
        },
      ],
    });
    await say(otherProjectId, "USER", "USER", text("Nothing like pricing here, but the word quokka is."));
  });

  afterAll(async () => {
    if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  describe.skipIf(!searchable)("searching the conversation", () => {
    const find = async (query: string, from?: string) =>
      (await searchHistory({ query, ...(from ? { from } : {}) }, projectId)) as {
        matches?: { n: number; from: string; excerpt: string }[];
        note?: string;
        error?: string;
      };

    test("finds a phrase with a quote and a line break in it, which the stored form could not", async () => {
      expect((await find('"use a dark"')).matches ?? []).toHaveLength(0);
      const quoted = await find('"pricing page use "dark" tones"');
      expect(quoted.matches?.map((m) => m.from)).toEqual(["user"]);
      // Typed on one line, found across the line break that is in the message.
      const lines = await find('"tones and a bigger"');
      expect(lines.matches).toHaveLength(1);
      expect(lines.matches![0]!.excerpt).toContain("tones and a bigger headline");
    });

    test("finds a word by its stem: measures finds measurements", async () => {
      const found = await find("measures");
      expect(found.matches?.map((m) => m.excerpt).join(" ")).toContain("measurements");
    });

    test("puts the message with every word first, and says when none has them all", async () => {
      const found = await find("pricing headline");
      // The first request and the file the agent wrote have both words; "a calmer
      // headline" has one and comes after them.
      const excerpts = found.matches!.map((m) => m.excerpt.toLowerCase());
      const both = excerpts.map((e) => e.includes("pricing") && e.includes("headline"));
      expect(both.slice(0, 2)).toEqual([true, true]);
      expect(excerpts.slice(2).some((e) => e.includes("calmer headline"))).toBe(true);
      const none = await find("zebrafish headline");
      expect(none.note).toContain("No message has all of");
      expect(none.matches!.length).toBeGreaterThan(0);
    });

    test("leaves tool results out, stays in its project, and can be limited to who spoke", async () => {
      const result = await find("appears in this tool result only");
      // Words in it are found elsewhere, but the result itself is never a match.
      expect((result.matches ?? []).some((m) => m.excerpt.includes("tool result only"))).toBe(false);
      expect((await find("quokka")).matches ?? []).toHaveLength(0);
      const byUser = await find("headline", "user");
      expect(byUser.matches!.every((m) => m.from === "user")).toBe(true);
    });

    test("words that are only inside a long file come after the messages where they were said", async () => {
      const found = await find("zebrafish");
      expect(found.matches!.map((m) => m.from)).toEqual(["user", "assistant"]);
      // The file is the newer message, and still comes second.
      expect(found.matches![0]!.n).toBeLessThan(found.matches![1]!.n);
    });

    test("does not read back past a cleared chat", async () => {
      const calmer = (await find("calmer")).matches![0]!.n;
      await prisma.contextCheckpoint.create({
        data: { projectId, upToSequence: calmer - 1, reason: "MANUAL_CLEAR", summary: "", tokensBefore: 0, tokensAfter: 0 },
      });
      // "headline" is in four messages; only the one after the clear can be found.
      const found = await find("headline");
      expect(found.matches!.map((m) => m.n)).toEqual([calmer]);
      await prisma.contextCheckpoint.deleteMany({ where: { projectId } });
    });

    test("reads the messages around one", async () => {
      const first = await prisma.message.findFirst({ where: { projectId }, orderBy: { sequence: "asc" } });
      const read = (await searchHistory({ around: first!.sequence + 1 }, projectId)) as { messages: { n: number }[] };
      expect(read.messages.length).toBeGreaterThanOrEqual(3);
      expect(read.messages.map((m) => m.n)).toContain(first!.sequence + 1);
      expect(((await searchHistory({ around: 99999999 }, projectId)) as { error?: string }).error).toContain("no message");
    });
  });

  describe("standing instructions", () => {
    test("are the account's and the project's, each in its own place", async () => {
      expect(await loadStanding(projectId)).toEqual({
        user: "I prefer dark interfaces.",
        project: "The logo is always green.",
      });
      expect(await loadStanding(otherProjectId)).toEqual({ user: "I prefer dark interfaces.", project: null });
    });

    test("a project that does not exist has none, and is not an error", async () => {
      expect(await loadStanding("00000000-0000-4000-8000-000000000000")).toEqual({ user: null, project: null });
    });
  });

  describe("the plan of a request, and of the one before", () => {
    async function job(finishReason: string, planned: boolean) {
      const j = await prisma.job.create({
        data: { projectId, prompt: "build it", type: "GENERATION", status: finishReason === "DONE" ? "COMPLETED" : "FAILED", finishReason: finishReason as never },
      });
      if (planned) {
        const m = await say(projectId, "ASSISTANT", "TOOL_REQ", { content: null, tool_calls: [] }, j.id);
        const call = (toolName: string, input: unknown) =>
          prisma.toolCall.create({
            data: { messageId: m.id, toolCallId: `${toolName}-${Math.random()}`, toolName, input: input as never, status: "SUCCESS", output: { success: true } },
          });
        await call("create_plan", { name: "Pricing page", description: "d", todos: ["Write the tiers", "Add the table", "Check on a phone"] });
        await new Promise((r) => setTimeout(r, 5));
        await call("update_todo", { sno: 1, status: "done" });
        await new Promise((r) => setTimeout(r, 5));
        await call("update_todo", { sno: 9, status: "done" }); // no such todo: changes nothing
      }
      return j;
    }

    test("a job's plan is its plan calls replayed, in order", async () => {
      const j = await job("DONE", true);
      const plan = await loadPlan(j.id);
      expect(plan!.name).toBe("Pricing page");
      expect(plan!.todos.map((t) => t.status)).toEqual(["done", "pending", "pending"]);
      expect(await loadPlan("00000000-0000-4000-8000-000000000000")).toBeNull();
    });

    test("a request that follows one that stopped part-way is shown what was left", async () => {
      await prisma.job.deleteMany({ where: { projectId } });
      const stopped = await job("TURN_CAP", true);
      const next = await prisma.job.create({ data: { projectId, prompt: "continue", type: "GENERATION" } });
      const note = await unfinishedPlanNote(projectId, next.id);
      expect(note).toContain("<tau_previous_plan>");
      expect(note).toContain("[pending] Add the table");
      expect(note).toContain("1 of 3 done");
      expect(stopped.id).not.toBe(next.id);
    });

    test("nothing is said when the one before finished, or had no plan", async () => {
      await prisma.job.deleteMany({ where: { projectId } });
      await job("DONE", true);
      const a = await prisma.job.create({ data: { projectId, prompt: "next", type: "GENERATION" } });
      expect(await unfinishedPlanNote(projectId, a.id)).toBeNull();
      await prisma.job.deleteMany({ where: { projectId } });
      await job("TURN_CAP", false);
      const b = await prisma.job.create({ data: { projectId, prompt: "next", type: "GENERATION" } });
      expect(await unfinishedPlanNote(projectId, b.id)).toBeNull();
    });
  });
});
