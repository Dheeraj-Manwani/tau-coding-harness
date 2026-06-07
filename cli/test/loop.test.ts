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

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

test("agent loop executes a tool call then completes", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "tau-loop-"));

  // Sequence two Anthropic responses: a write tool_use, then a final message.
  const responses = [
    jsonResponse({
      stop_reason: "tool_use",
      content: [
        {
          type: "tool_use",
          id: "tool_1",
          name: "write",
          input: { path: "out.txt", content: "from-agent" },
        },
      ],
    }),
    jsonResponse({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "Created out.txt." }],
    }),
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
