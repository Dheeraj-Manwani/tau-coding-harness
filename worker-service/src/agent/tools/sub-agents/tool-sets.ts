import type OpenAI from "openai";
import { TOOL_DEFINITIONS } from "../tools";

type ChatCompletionToolDef = OpenAI.Chat.Completions.ChatCompletionTool;

function pick(...names: string[]): ChatCompletionToolDef[] {
  return TOOL_DEFINITIONS.filter((t) =>
    names.includes(t.function.name),
  ) as unknown as ChatCompletionToolDef[];
}

/** explorer / debugger / verifier all read-only — never edit, create, or delete. */
export const EXPLORATION_TOOLS = pick("read_file", "run_command");

export const IMPLEMENTER_TOOLS = pick(
  "read_file",
  "run_command",
  "create_file",
  "edit_file",
  "delete_file",
);
