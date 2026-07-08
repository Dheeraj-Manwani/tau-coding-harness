import type OpenAI from "openai";
import { deepseek } from "../lib/deepseek";
import { prisma } from "../lib/prisma";
import { env } from "../lib/env";
import { getNextSequence } from "../lib/sequence";
import { meter } from "../lib/credits";
import { publish, makeIndexer } from "../lib/publish";
import type { Sandbox } from "../lib/sandbox";
import { TOOL_DEFINITIONS } from "./tools/tools";

export type SandboxRef = { current: Sandbox | null };
import { executeTool } from "./tools/executor";
import {
  MessageRole,
  MessageType,
  ToolCallStatus,
} from "../generated/prisma/enums";
import type { Prisma } from "../generated/prisma/client";
import {
  MAX_TOKENS,
  MAX_AGENT_TURNS,
  MAX_TRUNCATION_RETRIES,
  MAX_INTENT_NUDGES,
  MAX_PARALLEL_SUBAGENTS,
  INTENT_TO_CONTINUE_RE,
  TRUNCATION_NUDGE,
  PREVIEW_PORT,
  buildSystemPrompt,
} from "./config";
import { toTemplateKey } from "../templates/registry";
import type { Tool } from "./tools/tools";

type MessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type ToolCall = OpenAI.Chat.Completions.ChatCompletionMessageToolCall;
type FunctionToolCall =
  OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall;

function isFunctionToolCall(tc: ToolCall): tc is FunctionToolCall {
  return tc.type === "function";
}

const SUBAGENT_TOOLS = new Set<string>([
  "dispatch_explorer",
  "dispatch_debugger",
  "dispatch_verifier",
  // "dispatch_implementer",
]);

async function runPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) break;
      results[i] = await fn(items[i]!, i);
    }
  };
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

function deriveTitle(content: string | null): string {
  const text = (content ?? "").trim();
  if (!text) return "Untitled";
  const firstLine = text.split("\n")[0]?.trim() ?? "";
  const title = firstLine.split(/\s+/).slice(0, 5).join(" ");
  return title.slice(0, 80) || "Untitled";
}

interface StoredAssistant {
  content: string | null;
  tool_calls: ToolCall[] | null;
}

interface StoredToolResult {
  tool_call_id: string;
  content: string;
}

async function loadHistory(projectId: string): Promise<MessageParam[]> {
  const rows = await prisma.message.findMany({
    where: { projectId },
    orderBy: { sequence: "asc" },
  });

  const messages: MessageParam[] = [];

  for (const row of rows) {
    if (row.type === MessageType.TOOL_RES) {
      const results = row.content as unknown as StoredToolResult[];
      for (const r of results) {
        messages.push({
          role: "tool",
          tool_call_id: r.tool_call_id,
          content: r.content,
        });
      }
    } else if (row.role === MessageRole.ASSISTANT) {
      const stored = row.content as unknown as StoredAssistant;
      messages.push({
        role: "assistant",
        content: stored.content,
        ...(stored.tool_calls?.length ? { tool_calls: stored.tool_calls } : {}),
      });
    } else if (row.role === MessageRole.USER && row.type === MessageType.USER) {
      messages.push({
        role: "user",
        content:
          row.content as unknown as OpenAI.Chat.Completions.ChatCompletionUserMessageParam["content"],
      });
    }
  }

  return messages;
}

export async function runAgentLoop(
  jobId: string,
  projectId: string,
  userId: string,
  prompt: string,
  startIndex = 1,
  initialSandbox?: Sandbox,
): Promise<void> {
  void prompt;
  const sandboxRef: SandboxRef = { current: initialSandbox ?? null };
  const nextIndex = makeIndexer(startIndex);

  try {
    // Determine which template the agent is (or will be) working in. A template
    // is "selected" once files have been scaffolded against it — before that the
    // agent still gets to pick it via provision_sandbox, so it sees the chooser.
    const [project, fileCount] = await Promise.all([
      prisma.project.findUnique({
        where: { id: projectId },
        select: { templateKey: true },
      }),
      prisma.projectFile.count({ where: { projectId } }),
    ]);
    const selected = fileCount > 0;
    const systemPrompt = buildSystemPrompt({
      templateKey: toTemplateKey(project?.templateKey),
      selected,
    });

    const messages: MessageParam[] = [
      { role: "system", content: systemPrompt },
      ...(await loadHistory(projectId)),
    ];
    let turn = 0;
    let truncationRetries = 0;
    let intentNudges = 0;

    while (true) {
      if (turn++ >= MAX_AGENT_TURNS) {
        const message = `Agent exceeded ${MAX_AGENT_TURNS} turns without finishing`;
        await publish(jobId, { type: "error", message }, nextIndex());
        throw new Error(`${message} for job ${jobId}`);
      }

      const stream = deepseek.chat.completions.stream({
        model: env.DEEPSEEK_MODEL,
        max_tokens: MAX_TOKENS,
        tools:
          TOOL_DEFINITIONS as unknown as OpenAI.Chat.Completions.ChatCompletionTool[],
        messages,
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          await publish(
            jobId,
            { type: "llm_chunk", content: delta },
            nextIndex(),
          );
          process.stdout.write(delta);
        }
      }

      const completion = await stream.finalChatCompletion();
      const choice = completion.choices[0];
      if (!choice) throw new Error("Deepseek returned no completion choices");

      const assistant = choice.message;
      const toolCalls = (assistant.tool_calls ?? []).filter(isFunctionToolCall);
      const isToolTurn =
        choice.finish_reason === "tool_calls" && toolCalls.length > 0;
      // The model hit MAX_TOKENS mid-response — the turn is incomplete and any
      // tool call it started has truncated (invalid-JSON) arguments.
      const isTruncated = choice.finish_reason === "length";

      const inputTokens = completion.usage?.prompt_tokens ?? 0;
      const outputTokens = completion.usage?.completion_tokens ?? 0;

      const { assistantMessageId, sequence } = await prisma.$transaction(
        async (tx) => {
          const seq = await getNextSequence(tx, projectId);
          const created = await tx.message.create({
            data: {
              project: { connect: { id: projectId } },
              job: { connect: { id: jobId } },
              role: MessageRole.ASSISTANT,
              type: isToolTurn ? MessageType.TOOL_REQ : MessageType.RESULT,
              content: {
                content: assistant.content,
                // Never persist a truncated/partial tool call — on a recovery
                // reload it would be an assistant tool_call with no tool result,
                // which the completions API rejects.
                tool_calls: isToolTurn ? (assistant.tool_calls ?? null) : null,
              } as unknown as Prisma.InputJsonValue,
              sequence: seq,
              inputTokens,
              outputTokens,
            },
          });

          await tx.tokenUsage.create({
            data: {
              userId,
              projectId,
              jobId,
              model: env.DEEPSEEK_MODEL,
              inputTokens,
              outputTokens,
            },
          });

          return { assistantMessageId: created.id, sequence: seq };
        },
      );

      let holdExhausted = false;
      try {
        const meterResult = await meter(
          userId,
          jobId,
          env.DEEPSEEK_MODEL,
          inputTokens,
          outputTokens,
          sequence,
          { enforce: env.CREDITS_ENFORCE },
        );
        holdExhausted = meterResult.holdExhausted;
      } catch (err) {
        console.error(
          `[worker] meter failed for job ${jobId} seq ${sequence}`,
          err,
        );
      }

      if (env.CREDITS_ENFORCE && holdExhausted) {
        await publish(jobId, { type: "insufficient_credits" }, nextIndex());
        break;
      }

      // Truncated turn: the response was cut off at MAX_TOKENS. Don't treat it
      // as "done" — feed the partial text back and nudge the model to continue
      // in smaller pieces. Give up after a few consecutive truncations.
      if (isTruncated) {
        if (++truncationRetries > MAX_TRUNCATION_RETRIES) {
          const message = `Response truncated at the token limit ${MAX_TRUNCATION_RETRIES} times in a row`;
          await publish(jobId, { type: "error", message }, nextIndex());
          throw new Error(`${message} for job ${jobId}`);
        }
        if (assistant.content?.trim()) {
          messages.push({ role: "assistant", content: assistant.content });
        }
        messages.push({ role: "user", content: TRUNCATION_NUDGE });
        continue;
      }
      truncationRetries = 0;

      // Non-tool turn that merely narrates intent ("Let me write the page…")
      // without acting — nudge it to actually use its tools, up to a cap.
      if (
        !isToolTurn &&
        intentNudges < MAX_INTENT_NUDGES &&
        INTENT_TO_CONTINUE_RE.test((assistant.content ?? "").trim())
      ) {
        intentNudges++;
        if (assistant.content?.trim()) {
          messages.push({ role: "assistant", content: assistant.content });
        }
        messages.push({
          role: "user",
          content:
            "Continue and actually perform the work using your tools — don't " +
            "just describe what you're about to do. If the task is genuinely " +
            "complete, reply with your brief final summary.",
        });
        continue;
      }

      if (!isToolTurn) {
        if (sandboxRef.current) {
          const host = sandboxRef.current.getHost(PREVIEW_PORT);
          const url = `https://${host}`;
          await publish(jobId, { type: "preview_ready", url }, nextIndex());

          await prisma.fragment.create({
            data: {
              message: { connect: { id: assistantMessageId } },
              job: { connect: { id: jobId } },
              sandboxUrl: url,
              title: deriveTitle(assistant.content),
            },
          });
        }

        await publish(jobId, { type: "done" }, nextIndex());
        break;
      }

      messages.push({
        role: "assistant",
        content: assistant.content,
        tool_calls: assistant.tool_calls,
      });

      // Execute one tool call end to end (persist row, publish req/res, run it)
      // and return its stored result. Safe to call concurrently.
      const runOne = async (
        tc: FunctionToolCall,
      ): Promise<StoredToolResult> => {
        const toolName = tc.function.name;
        const toolCallId = tc.id;

        let input: unknown;
        try {
          input = tc.function.arguments
            ? JSON.parse(tc.function.arguments)
            : {};
        } catch {
          input = { _raw: tc.function.arguments };
        }

        const toolCallRow = await prisma.toolCall.create({
          data: {
            message: { connect: { id: assistantMessageId } },
            toolCallId,
            toolName,
            input: input as Prisma.InputJsonValue,
            status: ToolCallStatus.RUNNING,
            startedAt: new Date(),
          },
        });

        await publish(
          jobId,
          { type: "tool_req", toolName, toolCallId, input },
          nextIndex(),
        );

        let output: unknown;
        try {
          output = await executeTool(
            toolName as Tool,
            input,
            sandboxRef,
            jobId,
            projectId,
            userId,
            nextIndex,
          );
          await prisma.toolCall.update({
            where: { id: toolCallRow.id },
            data: {
              status: ToolCallStatus.SUCCESS,
              output: output as Prisma.InputJsonValue,
              completedAt: new Date(),
            },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          output = { error: message };
          await prisma.toolCall.update({
            where: { id: toolCallRow.id },
            data: {
              status: ToolCallStatus.FAILED,
              error: message,
              completedAt: new Date(),
            },
          });
        }

        await publish(
          jobId,
          { type: "tool_res", toolCallId, output },
          nextIndex(),
        );
        return { tool_call_id: toolCallId, content: JSON.stringify(output) };
      };

      const toolResults: StoredToolResult[] = new Array(toolCalls.length);
      let i = 0;
      while (i < toolCalls.length) {
        if (SUBAGENT_TOOLS.has(toolCalls[i]!.function.name)) {
          const start = i;
          while (
            i < toolCalls.length &&
            SUBAGENT_TOOLS.has(toolCalls[i]!.function.name)
          ) {
            i++;
          }
          const batch = toolCalls.slice(start, i);
          const batchResults = await runPool(
            batch,
            MAX_PARALLEL_SUBAGENTS,
            (tc) => runOne(tc),
          );
          for (let k = 0; k < batchResults.length; k++) {
            toolResults[start + k] = batchResults[k]!;
          }
        } else {
          toolResults[i] = await runOne(toolCalls[i]!);
          i++;
        }
      }

      for (const r of toolResults) {
        messages.push({
          role: "tool",
          tool_call_id: r.tool_call_id,
          content: r.content,
        });
      }

      await prisma.$transaction(async (tx) => {
        const sequence = await getNextSequence(tx, projectId);
        await tx.message.create({
          data: {
            project: { connect: { id: projectId } },
            job: { connect: { id: jobId } },
            role: MessageRole.USER,
            type: MessageType.TOOL_RES,
            content: toolResults as unknown as Prisma.InputJsonValue,
            sequence,
          },
        });
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[worker] agent loop failed for job ${jobId}`, err);
    await publish(jobId, { type: "error", message }, nextIndex());
    throw err;
  }
}
