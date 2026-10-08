import type OpenAI from "openai";
import type { TemplateGeneration } from "@/worker/templates/registry";
import { previewInspectAvailable } from "@/worker/lib/previewInspect";
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

/**
 * Opening the app in a browser, for the two sub-agents whose job is to find
 * out whether it works. Without it a debugger sent after "the page is blank"
 * can only read code and guess, and a verifier can only confirm that the page
 * answers — which it does whether or not the app in it has crashed.
 */
const BROWSER_TOOLS = pick("inspect_preview");

/** Whether a sub-agent of this kind is given the browser on this app. */
export function seesBrowser(kind: SubAgentKind, generation: TemplateGeneration): boolean {
  return generation === 2 && (kind === "debugger" || kind === "verifier") && previewInspectAvailable();
}

/** The tools a sub-agent of this kind gets on an app of this generation. */
export function toolsFor(
  kind: SubAgentKind,
  generation: TemplateGeneration,
): ChatCompletionToolDef[] {
  const base = kind === "implementer" ? IMPLEMENTER_TOOLS : EXPLORATION_TOOLS;
  if (generation !== 2) return base;
  return [...base, ...GUIDE_TOOLS, ...(seesBrowser(kind, generation) ? BROWSER_TOOLS : [])];
}
