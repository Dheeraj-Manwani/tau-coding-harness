import Anthropic from "@anthropic-ai/sdk";
import type { Credential } from "../config/store.ts";
import type {
  ChatHandlers,
  ChatRequest,
  ClientOptions,
  CompletionResult,
  ContentBlock,
  ProviderClient,
  ProviderModule,
} from "./types.ts";
import { resolveFetch } from "./types.ts";

const BASE_URL = "https://api.anthropic.com";

/** Anthropic requires `max_tokens`; use a sane default when the caller omits it. */
const DEFAULT_MAX_TOKENS = 8192;

export const anthropicModule: ProviderModule = {
  info: {
    id: "anthropic",
    name: "Anthropic",
    baseUrl: BASE_URL,
    aliases: ["claude"],
    models: [
      {
        id: "claude-opus-4-8",
        name: "Claude Opus 4.8",
        context: 1_000_000,
        recommended: true,
      },
      { id: "claude-opus-4-7", name: "Claude Opus 4.7", context: 1_000_000 },
      { id: "claude-opus-4-6", name: "Claude Opus 4.6", context: 1_000_000 },
      { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", context: 1_000_000 },
      { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", context: 200_000 },
    ],
  },

  createClient(cred: Credential, opts?: ClientOptions): ProviderClient {
    const client = new Anthropic({
      apiKey: cred.key,
      baseURL: BASE_URL,
      fetch: resolveFetch(opts),
    });

    return {
      async chat(
        req: ChatRequest,
        handlers?: ChatHandlers,
      ): Promise<CompletionResult> {
        const stream = client.messages.stream({
          model: req.model,
          max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
          system: req.system,
          // The internal message format mirrors Anthropic's content blocks,
          // so it passes through with only a structural cast.
          messages: req.messages as unknown as Anthropic.MessageParam[],
          tools: req.tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.schema as Anthropic.Tool.InputSchema,
          })),
        });

        if (handlers?.onText) {
          stream.on("text", (delta) => handlers.onText!(delta));
        }

        // finalMessage() resolves once the stream completes with the fully
        // assembled message (text + tool_use blocks, parsed inputs).
        const res = await stream.finalMessage();

        const content: ContentBlock[] = [];
        for (const block of res.content) {
          if (block.type === "text") {
            content.push({ type: "text", text: block.text });
          } else if (block.type === "tool_use") {
            content.push({
              type: "tool_use",
              id: block.id,
              name: block.name,
              input: block.input,
            });
          }
        }
        return { content, stopReason: res.stop_reason ?? "end_turn" };
      },
    };
  },
};
