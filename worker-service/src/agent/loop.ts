import type OpenAI from "openai";
import { deepseek } from "../lib/deepseek";
import { prisma } from "../lib/prisma";
import { env } from "../lib/env";
import { getNextSequence } from "../lib/sequence";
import { meter } from "../lib/credits";
import { publish, makeIndexer } from "../lib/publish";
import type { Sandbox } from "../lib/sandbox";
import { TOOL_DEFINITIONS } from "./tools";

export type SandboxRef = { current: Sandbox | null };
import { executeTool } from "./executor";
import {
  MessageRole,
  MessageType,
  ToolCallStatus,
} from "../generated/prisma/enums";
import type { Prisma } from "../generated/prisma/client";
import { MAX_TOKENS, PREVIEW_PORT, SYSTEM_PROMPT } from "./config";

type MessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type ToolCall = OpenAI.Chat.Completions.ChatCompletionMessageToolCall;
type FunctionToolCall =
  OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall;

function isFunctionToolCall(tc: ToolCall): tc is FunctionToolCall {
  return tc.type === "function";
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
    const messages: MessageParam[] = [
      { role: "system", content: SYSTEM_PROMPT },
      ...(await loadHistory(projectId)),
    ];
    debugger;
    console.log("messages ::: ");

    while (true) {
      const stream = deepseek.chat.completions.stream({
        model: env.DEEPSEEK_MODEL,
        max_tokens: MAX_TOKENS,
        tools: TOOL_DEFINITIONS,
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
                tool_calls: assistant.tool_calls ?? null,
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

      const toolResults: StoredToolResult[] = [];

      for (const tc of toolCalls) {
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
            toolName,
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

        const content = JSON.stringify(output);
        toolResults.push({ tool_call_id: toolCallId, content });
        messages.push({ role: "tool", tool_call_id: toolCallId, content });
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
