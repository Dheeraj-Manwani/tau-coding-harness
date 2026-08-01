import type OpenAI from "openai";
import { TOOL_DEFINITIONS } from "../tools";

type ChatCompletionToolDef = OpenAI.Chat.Completions.ChatCompletionTool;

function pick(...names: string[]): ChatCompletionToolDef[] {
  return TOOL_DEFINITIONS.filter((t) =>
    names.includes(t.function.name),
  ) as unknown as ChatCompletionToolDef[];
}

/** explorer / debugger / verifier all read-only — never edit, create, or delete. */
export const EXPLORATION_TOOLS = pick(
  "read_file",
  "list_dir",
  "run_command",
  "tail_command_output",
  "wait_for_port",
  "check_sandbox",
  "web_search",
);

/** implementer gets read tools too, so it can infer conventions instead of
 *  requiring every detail to be pre-resolved by the dispatching agent. */
export const IMPLEMENTER_TOOLS = pick(
  "read_file",
  "list_dir",
  "run_command",
  "tail_command_output",
  "wait_for_port",
  "check_sandbox",
  "create_file",
  "edit_file",
  "delete_file",
);
