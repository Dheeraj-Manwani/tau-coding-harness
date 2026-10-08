import type OpenAI from "openai";
import type { TemplateGeneration } from "@/worker/templates/registry";
import { BASE_APP_TOOLS, TOOL_DEFINITIONS } from "../tools";
import type { SubAgentKind } from "./config";

type ChatCompletionToolDef = OpenAI.Chat.Completions.ChatCompletionTool;

const ALL_TOOLS = [...TOOL_DEFINITIONS, ...BASE_APP_TOOLS];

function pick(...names: string[]): ChatCompletionToolDef[] {
  return ALL_TOOLS.filter((t) =>
    names.includes(t.function.name),
  ) as unknown as ChatCompletionToolDef[];
}

/** explorer / debugger / verifier all read-only — never edit, create, or delete. */
export const EXPLORATION_TOOLS = pick(
  "read_file",
  "list_dir",
  "grep",
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
  "grep",
  "run_command",
  "tail_command_output",
  "wait_for_port",
  "check_sandbox",
  "create_file",
  "edit_file",
  "delete_file",
);

/**
 * tau's guides, for a sub-agent on the base app. Its persona lists them
 * (`config.ts`): without the list it would not know to ask, and without the
 * tool it could not — which is how a debugger came to spend its turns reading
 * `node_modules` to learn what the `components` guide says in a paragraph. It
 * can also look back through the project's conversation, for what the user said
 * that its task does not repeat.
 */
const GUIDE_TOOLS = pick("read_doc", "search_history");

/** The tools a sub-agent of this kind gets on an app of this generation. */
export function toolsFor(
  kind: SubAgentKind,
  generation: TemplateGeneration,
): ChatCompletionToolDef[] {
  const base = kind === "implementer" ? IMPLEMENTER_TOOLS : EXPLORATION_TOOLS;
  return generation === 2 ? [...base, ...GUIDE_TOOLS] : base;
}
