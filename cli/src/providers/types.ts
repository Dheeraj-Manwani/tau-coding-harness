import type { Credential } from "../config/store.ts";
import type { Tool } from "../agent/tools/index.ts";

// ---------------------------------------------------------------------------
// Provider-agnostic message format (Anthropic-style content blocks). Every
// adapter translates this to and from its own SDK's wire format, so the agent
// loop never has to know which provider it is talking to.
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

// ---------------------------------------------------------------------------
// Catalog metadata (display + selection only — no secrets, no SDK objects).
// ---------------------------------------------------------------------------

/** One model offered by a provider. */
export interface ModelInfo {
  /** Wire id sent to the provider. */
  id: string;
  /** Human-friendly label for menus. */
  name: string;
  /** Context window in tokens, for display only. */
  context?: number;
  /** Marks the recommended default model for the provider. */
  recommended?: boolean;
}

/** Static, non-secret description of a provider. */
export interface ProviderInfo {
  id: string;
  name: string;
  /** API base URL handed to the provider's SDK. */
  baseUrl: string;
  /** Alternate names that resolve to this provider (e.g. "gemini" -> google). */
  aliases?: string[];
  models: ModelInfo[];
}

// ---------------------------------------------------------------------------
// Client contract — what the agent loop actually calls.
// ---------------------------------------------------------------------------

/** A single non-streaming completion request, already provider-agnostic. */
export interface ChatRequest {
  model: string;
  system: string;
  messages: Message[];
  tools: Tool[];
  /**
   * Max output tokens. Required by some providers (Anthropic), optional for
   * others — each adapter decides how to apply or default it.
   */
  maxTokens?: number;
}

/** Streaming callbacks for a completion as it is produced. */
export interface ChatHandlers {
  /** Invoked for each incremental assistant-text delta as it streams in. */
  onText?: (delta: string) => void;
}

/** A live client bound to one provider + credential. */
export interface ProviderClient {
  /**
   * Run one non-streaming-from-the-caller's-view completion. Internally the
   * adapters stream (so text can surface live via {@link ChatHandlers.onText}
   * and to avoid HTTP timeouts), but the returned result is the fully
   * assembled message — including tool_use blocks — which the agent loop needs.
   */
  chat(req: ChatRequest, handlers?: ChatHandlers): Promise<CompletionResult>;
}

/** A fetch-compatible call signature (looser than `typeof fetch` so plain
 *  wrappers and SDK fetch options both satisfy it). */
export type FetchLike = (input: any, init?: any) => Promise<Response>;

/** Knobs an adapter accepts at construction (mainly a seam for tests). */
export interface ClientOptions {
  /** Override the fetch implementation — used to mock HTTP in tests. */
  fetch?: FetchLike;
}

/**
 * A provider plugged into the registry: catalog metadata plus a factory that
 * builds its credential-bound client. Adding a provider = exporting one of
 * these from a new module and registering it.
 */
export interface ProviderModule {
  info: ProviderInfo;
  createClient(cred: Credential, opts?: ClientOptions): ProviderClient;
}

/**
 * Resolve the fetch implementation for an adapter. Defaults to a thin wrapper
 * that reads `globalThis.fetch` at call time, so a test can swap the global
 * even after the client has been constructed.
 */
export function resolveFetch(opts?: ClientOptions): FetchLike {
  return opts?.fetch ?? ((input, init) => globalThis.fetch(input, init));
}
