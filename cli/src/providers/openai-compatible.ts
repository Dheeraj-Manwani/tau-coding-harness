import OpenAI from "openai";
import type { Credential } from "../config/store.ts";
import type {
  ChatHandlers,
  ChatRequest,
  ClientOptions,
  CompletionResult,
  ContentBlock,
  Message,
  ProviderClient,
} from "./types.ts";
import { resolveFetch } from "./types.ts";

/**
 * Which request field carries the output-token cap. OpenAI's o-series rejects
 * the legacy `max_tokens` and requires `max_completion_tokens`; most other
 * OpenAI-compatible providers still expect `max_tokens`.
 */
export type MaxTokensParam = "max_tokens" | "max_completion_tokens";

export interface OpenAICompatibleConfig {
  baseURL: string;
  maxTokensParam?: MaxTokensParam;
}

/**
 * Build a {@link ProviderClient} for any provider that speaks the OpenAI
 * `/chat/completions` protocol (OpenAI, DeepSeek, Gemini's compat endpoint, …).
 * The only per-provider differences are the base URL and the max-tokens field,
 * so each such provider is just a thin module that calls this factory.
 */
export function createOpenAICompatibleClient(
  cfg: OpenAICompatibleConfig,
  cred: Credential,
  opts?: ClientOptions,
): ProviderClient {
  const client = new OpenAI({
    apiKey: cred.key,
    baseURL: cfg.baseURL,
    fetch: resolveFetch(opts),
  });

  return {
    async chat(
      req: ChatRequest,
      handlers?: ChatHandlers,
    ): Promise<CompletionResult> {
      const params: OpenAI.Chat.ChatCompletionCreateParamsStreaming = {
        model: req.model,
        messages: toOpenAIMessages(req.system, req.messages),
        stream: true,
      };

      if (req.tools.length > 0) {
        params.tools = req.tools.map((t) => ({
          type: "function",
          function: {
            name: t.name,
            description: t.description,
            parameters: t.schema as unknown as Record<string, unknown>,
          },
        }));
        params.tool_choice = "auto";
      }

      if (req.maxTokens != null) {
        params[cfg.maxTokensParam ?? "max_tokens"] = req.maxTokens;
      }

      const stream = await client.chat.completions.create(params);

      // Tool-call arguments stream in fragments, keyed by their array index;
      // accumulate per index and assemble once the stream ends.
      let text = "";
      let stopReason = "stop";
      const toolSlots = new Map<
        number,
        { id: string; name: string; args: string }
      >();

      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (!choice) continue;

        const delta = choice.delta;
        if (delta?.content) {
          text += delta.content;
          handlers?.onText?.(delta.content);
        }
        for (const tc of delta?.tool_calls ?? []) {
          const slot = toolSlots.get(tc.index) ?? { id: "", name: "", args: "" };
          if (tc.id) slot.id = tc.id;
          if (tc.function?.name) slot.name = tc.function.name;
          if (tc.function?.arguments) slot.args += tc.function.arguments;
          toolSlots.set(tc.index, slot);
        }
        if (choice.finish_reason) stopReason = choice.finish_reason;
      }

      const content: ContentBlock[] = [];
      if (text) content.push({ type: "text", text });
      for (const slot of [...toolSlots.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, s]) => s)) {
        content.push({
          type: "tool_use",
          id: slot.id,
          name: slot.name,
          input: safeJson(slot.args),
        });
      }

      return { content, stopReason };
    },
  };
}

/** Translate the internal content-block format into OpenAI chat messages. */
function toOpenAIMessages(
  system: string,
  messages: Message[],
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const out: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: system },
  ];

  for (const m of messages) {
    if (m.role === "assistant") {
      const text = m.content
        .filter(
          (b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text",
        )
        .map((b) => b.text)
        .join("");
      const toolCalls = m.content
        .filter(
          (b): b is Extract<ContentBlock, { type: "tool_use" }> =>
            b.type === "tool_use",
        )
        .map((b) => ({
          id: b.id,
          type: "function" as const,
          function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
        }));
      const entry: OpenAI.Chat.ChatCompletionAssistantMessageParam = {
        role: "assistant",
        content: text || null,
      };
      if (toolCalls.length) entry.tool_calls = toolCalls;
      out.push(entry);
      continue;
    }

    // user role: may carry tool_result blocks (become role:"tool") and/or text.
    for (const r of m.content.filter(
      (b): b is Extract<ContentBlock, { type: "tool_result" }> =>
        b.type === "tool_result",
    )) {
      out.push({ role: "tool", tool_call_id: r.tool_use_id, content: r.content });
    }
    const text = m.content
      .filter(
        (b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text",
      )
      .map((b) => b.text)
      .join("");
    if (text) out.push({ role: "user", content: text });
  }

  return out;
}

function safeJson(raw: string): any {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}
