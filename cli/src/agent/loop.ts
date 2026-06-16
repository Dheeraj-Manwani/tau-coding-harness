import type {
  ContentBlock,
  Message,
  ProviderClient,
} from "../providers/types.ts";
import { ToolError, type Tool, type ToolContext } from "./tools/index.ts";

/**
 * UI seam for the agent loop. The loop reports what it is doing through these
 * hooks; the top-level session wires them to the terminal (spinner + rendered
 * output), while sub-agents pass a silent implementation so their work runs
 * headlessly. See {@link TerminalReporter} and {@link SilentReporter}.
 */
export interface AgentReporter {
  /** A model step is starting — about to send a completion request. */
  beginStep(): void;
  /** An incremental assistant-text delta streamed in for the current step. */
  onText(delta: string): void;
  /** The current step's assistant text is complete (response assembled). */
  endStep(): void;
  /** The completion request failed; the loop aborts after this. */
  modelError(message: string): void;
  /** This step's tool calls are about to run. */
  beginTools(): void;
  /** A specific tool call is about to run — its `summary` is the same one
   *  later passed to {@link toolDone}. Optional: front-ends that show a live
   *  per-tool status (e.g. the TUI status line) implement this. */
  beginTool?(toolName: string, summary: string): void;
  /** A tool call finished (success or error). `output` is its raw result. */
  toolDone(
    toolName: string,
    summary: string,
    output: string,
    isError: boolean,
  ): void;
  /** The loop hit the step cap without the model finishing its turn. */
  exhausted(maxSteps: number): void;
}

export interface AgentLoopOptions {
  client: ProviderClient;
  /**
   * Suppliers for the system prompt and tool set, re-read each iteration so a
   * mid-turn change (e.g. a top-level `switch_mode`) takes effect on the next
   * step. Sub-agents pass constants wrapped in a thunk.
   */
  system: () => string;
  tools: () => Tool[];
  toolCtx: ToolContext;
  /** Conversation, seeded with at least one user message. Mutated in place. */
  messages: Message[];
  model: string;
  maxTokens?: number;
  /** Hard cap on tool-call iterations, to avoid runaway loops. */
  maxSteps: number;
  reporter: AgentReporter;
}

/**
 * Run the agent tool-call loop until the model stops requesting tools, the
 * completion request errors, or the step cap is hit. Appends assistant turns
 * and tool results to `messages` in place. Returns the final assistant text
 * (the last turn's concatenated text blocks) — used by sub-agents to surface a
 * summary; the top-level session ignores it since the reporter already printed.
 */
export async function runAgentLoop(opts: AgentLoopOptions): Promise<string> {
  const { client, toolCtx, messages, model, maxTokens, maxSteps, reporter } =
    opts;
  let finalText = "";

  for (let step = 0; step < maxSteps; step++) {
    reporter.beginStep();

    let result;
    try {
      result = await client.chat(
        {
          model,
          system: opts.system(),
          messages,
          tools: opts.tools(),
          maxTokens,
        },
        { onText: (delta) => reporter.onText(delta) },
      );
    } catch (e: any) {
      reporter.endStep();
      reporter.modelError(e?.message ?? String(e));
      return finalText;
    }

    reporter.endStep();

    // Drop empty text blocks — providers reject them when echoed back.
    const content = result.content.filter(
      (b) => b.type !== "text" || b.text.trim().length > 0,
    );
    messages.push({ role: "assistant", content });

    const text = content
      .filter((b): b is Extract<ContentBlock, { type: "text" }> =>
        b.type === "text",
      )
      .map((b) => b.text)
      .join("");
    if (text.trim()) finalText = text;

    const toolUses = content.filter(
      (b): b is Extract<ContentBlock, { type: "tool_use" }> =>
        b.type === "tool_use",
    );
    if (toolUses.length === 0) return finalText; // turn complete

    reporter.beginTools();
    const results: ContentBlock[] = [];
    for (const call of toolUses) {
      results.push(await runTool(call, opts.tools(), toolCtx, reporter));
    }
    messages.push({ role: "user", content: results });
  }

  reporter.exhausted(maxSteps);
  return finalText;
}

async function runTool(
  call: Extract<ContentBlock, { type: "tool_use" }>,
  tools: Tool[],
  toolCtx: ToolContext,
  reporter: AgentReporter,
): Promise<ContentBlock> {
  const tool = tools.find((t) => t.name === call.name);
  if (!tool) {
    const message = `Unknown tool: ${call.name}`;
    reporter.toolDone(call.name, message, message, true);
    return {
      type: "tool_result",
      tool_use_id: call.id,
      content: message,
      is_error: true,
    };
  }

  const summary = tool.summarize(call.input);
  reporter.beginTool?.(tool.name, summary);
  try {
    const output = await tool.run(call.input, toolCtx);
    reporter.toolDone(tool.name, summary, output, false);
    return { type: "tool_result", tool_use_id: call.id, content: output };
  } catch (e: any) {
    const message =
      e instanceof ToolError ? e.message : `Tool failed: ${e.message ?? e}`;
    reporter.toolDone(tool.name, summary, message, true);
    return {
      type: "tool_result",
      tool_use_id: call.id,
      content: message,
      is_error: true,
    };
  }
}
