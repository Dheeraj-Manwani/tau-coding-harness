import type { Credential } from "../config/store.ts";
import type { ProviderInfo } from "../providers/registry.ts";
import type { Tool } from "./tools/index.ts";

// ---------------------------------------------------------------------------
// Internal, provider-agnostic message format (Anthropic-style content blocks).
// ---------------------------------------------------------------------------

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: any }
  | {
      type: "tool_result";
      tool_use_id: string;
      content: string;
      is_error?: boolean;
    };

export interface Message {
  role: "user" | "assistant";
  content: ContentBlock[];
}

export interface CompletionResult {
  /** Assistant content blocks (text + tool_use). */
  content: ContentBlock[];
  stopReason: string;
}

export interface CompletionRequest {
  provider: ProviderInfo;
  cred: Credential;
  model: string;
  system: string;
  messages: Message[];
  tools: Tool[];
}

const ANTHROPIC_VERSION = "2023-06-01";

export async function complete(
  req: CompletionRequest,
): Promise<CompletionResult> {
  if (req.provider.protocol === "anthropic") {
    return completeAnthropic(req);
  }
  return completeOpenAI(req);
}

// ---------------------------------------------------------------------------
// Anthropic /v1/messages
// ---------------------------------------------------------------------------

async function completeAnthropic(
  req: CompletionRequest,
): Promise<CompletionResult> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "anthropic-version": ANTHROPIC_VERSION,
    "x-api-key": req.cred.key,
  };

  const body = {
    model: req.model,
    system: req.system,
    messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    tools: req.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.schema,
    })),
  };

  const res = await fetch(`${req.provider.baseUrl}/v1/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(
      `Anthropic API error ${res.status}: ${await safeText(res)}`,
    );
  }

  const data: any = await res.json();
  const content: ContentBlock[] = (data.content ?? []).map((block: any) => {
    if (block.type === "tool_use") {
      return {
        type: "tool_use",
        id: block.id,
        name: block.name,
        input: block.input,
      };
    }
    return { type: "text", text: block.text ?? "" };
  });
  return { content, stopReason: data.stop_reason ?? "end_turn" };
}

// ---------------------------------------------------------------------------
// OpenAI-compatible /chat/completions
// ---------------------------------------------------------------------------

async function completeOpenAI(
  req: CompletionRequest,
): Promise<CompletionResult> {
  const messages = toOpenAIMessages(req.system, req.messages);
  const tools = req.tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.schema,
    },
  }));

  const res = await fetch(`${req.provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${req.cred.key}`,
    },
    body: JSON.stringify({
      model: req.model,
      messages,
      tools,
      tool_choice: "auto",
    }),
  });

  if (!res.ok) {
    throw new Error(
      `${req.provider.name} API error ${res.status}: ${await safeText(res)}`,
    );
  }

  const data: any = await res.json();
  const choice = data.choices?.[0];
  const msg = choice?.message ?? {};
  const content: ContentBlock[] = [];
  if (msg.content) content.push({ type: "text", text: msg.content });
  for (const call of msg.tool_calls ?? []) {
    content.push({
      type: "tool_use",
      id: call.id,
      name: call.function.name,
      input: safeJson(call.function.arguments),
    });
  }
  return { content, stopReason: choice?.finish_reason ?? "stop" };
}

/** Translate the internal content-block format into OpenAI chat messages. */
function toOpenAIMessages(system: string, messages: Message[]): any[] {
  const out: any[] = [{ role: "system", content: system }];

  for (const m of messages) {
    if (m.role === "assistant") {
      const text = m.content
        .filter(
          (b): b is Extract<ContentBlock, { type: "text" }> =>
            b.type === "text",
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
          type: "function",
          function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
        }));
      const entry: any = { role: "assistant", content: text || null };
      if (toolCalls.length) entry.tool_calls = toolCalls;
      out.push(entry);
      continue;
    }

    // user role: may carry tool_result blocks (become role:tool) and/or text.
    const toolResults = m.content.filter(
      (b): b is Extract<ContentBlock, { type: "tool_result" }> =>
        b.type === "tool_result",
    );
    for (const r of toolResults) {
      out.push({
        role: "tool",
        tool_call_id: r.tool_use_id,
        content: r.content,
      });
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

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "<no body>";
  }
}
