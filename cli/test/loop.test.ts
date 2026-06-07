import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Session } from "../src/agent/session.ts";
import { getProvider } from "../src/providers/registry.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Build a streaming (SSE) Response, the shape the Anthropic SDK expects. */
function sseResponse(events: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const e of events) controller.enqueue(enc.encode(e));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function event(name: string, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

const messageStart = {
  type: "message_start",
  message: {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-opus-4-8",
    content: [],
    stop_reason: null,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 0 },
  },
};

/** Anthropic SSE stream for a single tool_use block. */
function toolUseStream(id: string, name: string, input: unknown): Response {
  return sseResponse([
    event("message_start", messageStart),
    event("content_block_start", {
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", id, name, input: {} },
    }),
    event("content_block_delta", {
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: JSON.stringify(input) },
    }),
    event("content_block_stop", { type: "content_block_stop", index: 0 }),
    event("message_delta", {
      type: "message_delta",
      delta: { stop_reason: "tool_use", stop_sequence: null },
      usage: { output_tokens: 10 },
    }),
    event("message_stop", { type: "message_stop" }),
  ]);
}

/** Anthropic SSE stream for a single text block. */
function textStream(text: string): Response {
  return sseResponse([
    event("message_start", messageStart),
    event("content_block_start", {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    }),
    event("content_block_delta", {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text },
    }),
    event("content_block_stop", { type: "content_block_stop", index: 0 }),
    event("message_delta", {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: 5 },
    }),
    event("message_stop", { type: "message_stop" }),
  ]);
}

test("agent loop executes a tool call then completes", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "tau-loop-"));

  // Sequence two Anthropic responses: a write tool_use, then a final message.
  const responses = [
    toolUseStream("tool_1", "write", { path: "out.txt", content: "from-agent" }),
    textStream("Created out.txt."),
  ];

  let calls = 0;
  const bodies: any[] = [];
  globalThis.fetch = (async (_url: string, init: any) => {
    bodies.push(JSON.parse(init.body));
    return responses[calls++]!;
  }) as unknown as typeof fetch;

  const session = new Session({
    provider: getProvider("anthropic")!,
    cred: { type: "api", key: "test" },
    model: "claude-opus-4-8",
    mode: "build",
    cwd,
  });

  await session.send("create out.txt");

  // The model made two requests (initial + after tool result).
  expect(calls).toBe(2);

  // The tool actually wrote the file.
  expect(await readFile(join(cwd, "out.txt"), "utf8")).toBe("from-agent");

  // Transcript: user, assistant(tool_use), user(tool_result), assistant(text).
  const roles = session.messages.map((m) => m.role);
  expect(roles).toEqual(["user", "assistant", "user", "assistant"]);

  const toolResult = session.messages[2]!.content[0]!;
  expect(toolResult.type).toBe("tool_result");

  // The second request echoed the prior tool_use + tool_result back to the model.
  expect(bodies[1].messages).toHaveLength(3);
});
