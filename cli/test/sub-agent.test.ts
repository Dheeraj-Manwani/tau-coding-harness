import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSubAgentRunner } from "../src/agent/sub-agent.ts";
import { ToolError } from "../src/agent/tools/types.ts";
import type {
  ChatRequest,
  CompletionResult,
  ContentBlock,
  ProviderClient,
} from "../src/providers/types.ts";

async function scratch(): Promise<string> {
  return mkdtemp(join(tmpdir(), "tau-subagent-"));
}

const text = (t: string): ContentBlock => ({ type: "text", text: t });
const toolUse = (id: string, name: string, input: unknown): ContentBlock => ({
  type: "tool_use",
  id,
  name,
  input,
});

/** A scripted ProviderClient: returns queued completions and records requests. */
function mockClient(responses: CompletionResult[]): {
  client: ProviderClient;
  requests: ChatRequest[];
} {
  const requests: ChatRequest[] = [];
  let i = 0;
  const client: ProviderClient = {
    async chat(req) {
      // Snapshot `messages` — the loop mutates the array in place, so storing
      // the reference would let later appends leak into this record.
      requests.push({ ...req, messages: [...req.messages] });
      const next = responses[i++];
      if (!next) throw new Error("mock client ran out of responses");
      return next;
    },
  };
  return { client, requests };
}

test("a sub-agent cannot spawn further sub-agents", async () => {
  const { client } = mockClient([]);
  const run = createSubAgentRunner(client, "m", await scratch(), undefined, 1);
  await expect(run({ kind: "search", task: "x" })).rejects.toBeInstanceOf(
    ToolError,
  );
});

test("rejects an empty task", async () => {
  const { client } = mockClient([]);
  const run = createSubAgentRunner(client, "m", await scratch(), undefined, 0);
  await expect(run({ kind: "search", task: "   " })).rejects.toBeInstanceOf(
    ToolError,
  );
});

test("search sub-agent runs read-only and returns its summary", async () => {
  const { client, requests } = mockClient([
    {
      content: [toolUse("t1", "read", { path: "nope.txt" })],
      stopReason: "tool_use",
    },
    { content: [text("Found it in foo.ts:10")], stopReason: "end_turn" },
  ]);
  const run = createSubAgentRunner(client, "m", await scratch(), undefined, 0);

  const out = await run({ kind: "search", task: "where is X" });
  expect(out).toBe("Found it in foo.ts:10");

  // The search sub-agent is given only the read-only tool set — no write/edit,
  // no interactive or dispatch tools.
  const toolNames = requests[0]!.tools.map((t) => t.name).sort();
  expect(toolNames).toEqual(["bash", "read"]);
});

test("a read-only sub-agent has no write tool and cannot create files", async () => {
  const cwd = await scratch();
  const { client, requests } = mockClient([
    {
      content: [toolUse("t1", "write", { path: "x.txt", content: "hi" })],
      stopReason: "tool_use",
    },
    { content: [text("done")], stopReason: "end_turn" },
  ]);
  const run = createSubAgentRunner(client, "m", cwd, undefined, 0);

  await run({ kind: "review", task: "review the diff" });

  // The write attempt came back as an error tool_result (unknown tool)...
  const toolResult = requests[1]!.messages.at(-1)!.content[0]!;
  expect(toolResult.type).toBe("tool_result");
  expect("is_error" in toolResult && toolResult.is_error).toBe(true);
  // ...and nothing was written to disk.
  expect(existsSync(join(cwd, "x.txt"))).toBe(false);
});

test("code sub-agent can write files and reports a summary", async () => {
  const cwd = await scratch();
  const { client } = mockClient([
    {
      content: [
        toolUse("t1", "write", { path: "out.txt", content: "from-sub" }),
      ],
      stopReason: "tool_use",
    },
    { content: [text("Wrote out.txt")], stopReason: "end_turn" },
  ]);
  const run = createSubAgentRunner(client, "m", cwd, undefined, 0);

  const out = await run({ kind: "code", task: "create out.txt" });
  expect(out).toBe("Wrote out.txt");
  expect(await readFile(join(cwd, "out.txt"), "utf8")).toBe("from-sub");
});
