import type { Message, ProviderClient } from "../providers/types.ts";
import { runAgentLoop } from "./loop.ts";
import { SilentReporter } from "./reporter.ts";
import { ALL_TOOLS, ToolError, type ToolContext } from "./tools/index.ts";
import type { SubAgentKind, SubAgentSpec } from "./tools/types.ts";

/** How deep sub-agents may nest. 1 = top-level may spawn, sub-agents may not. */
const MAX_DEPTH = 1;
/** Tool-call cap for a sub-agent — tighter than the top-level session's. */
const SUB_AGENT_MAX_STEPS = 30;

interface SubAgentDef {
  /** The sub-agent's system prompt (its role and operating rules). */
  systemPrompt: string;
  /** Names of {@link ALL_TOOLS} this sub-agent may use. Never includes the
   *  interactive (`switch_mode`, `prompt_user`) or dispatch tools — sub-agents
   *  are headless and may not recurse. */
  toolNames: string[];
  /** Read-only sub-agents are blocked from writing/editing files (their shell
   *  access is by design unsandboxed; the prompt sets the expectation). */
  readOnly: boolean;
}

const SHARED_RULES =
  "You are a sub-agent dispatched by a parent coding agent to handle one " +
  "focused task. You share none of the parent's conversation — work only from " +
  "the task and context given. You cannot ask the user questions. When done, " +
  "reply with a single, self-contained summary that answers the task; that " +
  "text is all the parent receives, so make it complete and concise.";

const DEFS: Record<SubAgentKind, SubAgentDef> = {
  search: {
    toolNames: ["read", "bash"],
    readOnly: true,
    systemPrompt:
      `${SHARED_RULES}\n\nRole: read-only codebase explorer. Investigate the ` +
      `project to answer the question — read files and run read-only shell ` +
      `commands (grep, find, ls, cat). Do not modify anything. Return a precise ` +
      `answer with the relevant file paths and line references, not a transcript ` +
      `of your search.`,
  },
  review: {
    toolNames: ["read", "bash"],
    readOnly: true,
    systemPrompt:
      `${SHARED_RULES}\n\nRole: read-only code reviewer. Examine the code in ` +
      `scope (e.g. the current git diff via \`git diff\`, or the named files) ` +
      `for correctness bugs, edge cases, and risky changes. Read files and run ` +
      `read-only commands; do not modify anything. Return a short, prioritized ` +
      `list of findings — each with the file/line and why it matters — or state ` +
      `clearly that you found no issues.`,
  },
  code: {
    toolNames: ["read", "write", "edit", "bash"],
    readOnly: false,
    systemPrompt:
      `${SHARED_RULES}\n\nRole: autonomous implementer. Carry out the delegated ` +
      `change end to end — read what you need, make the edits, and run builds or ` +
      `tests to verify. Match the surrounding code's conventions. Return a ` +
      `summary of what you changed (the files touched and the gist of each ` +
      `change) and the state of any verification you ran.`,
  },
};

/**
 * Build the `spawnSubAgent` capability for a session: a function that runs a
 * headless sub-agent of the requested kind against the same provider/model and
 * resolves with its final summary. The returned function enforces the recursion
 * cap and restricts the sub-agent's tools and write access per its kind.
 */
export function createSubAgentRunner(
  client: ProviderClient,
  model: string,
  cwd: string,
  maxTokens: number | undefined,
  depth: number,
): (spec: SubAgentSpec) => Promise<string> {
  return async (spec) => {
    if (depth >= MAX_DEPTH) {
      throw new ToolError(
        "Sub-agents cannot spawn further sub-agents — do this work directly.",
      );
    }
    const def = DEFS[spec.kind];
    if (!def) throw new ToolError(`Unknown sub-agent kind: ${spec.kind}`);

    const task = String(spec.task ?? "").trim();
    if (!task) throw new ToolError("A sub-agent `task` must not be empty.");

    const tools = ALL_TOOLS.filter((t) => def.toolNames.includes(t.name));

    const childCtx: ToolContext = {
      cwd,
      subAgentDepth: depth + 1,
      // Defense in depth: read-only kinds carry no write/edit tool anyway, but
      // also refuse any write that reaches the guard. No promptUser /
      // requestModeSwitch / spawnSubAgent — headless and non-recursive.
      assertWritable: def.readOnly
        ? () => {
            throw new ToolError(
              "This sub-agent is read-only and cannot modify files.",
            );
          }
        : undefined,
    };

    const messages: Message[] = [
      { role: "user", content: [{ type: "text", text: renderTask(spec, task) }] },
    ];

    const summary = await runAgentLoop({
      client,
      system: () => def.systemPrompt,
      tools: () => tools,
      toolCtx: childCtx,
      messages,
      model,
      maxTokens,
      maxSteps: SUB_AGENT_MAX_STEPS,
      reporter: new SilentReporter(),
    });

    return (
      summary.trim() ||
      "(the sub-agent finished without producing a summary; it may have run out of steps)"
    );
  };
}

function renderTask(spec: SubAgentSpec, task: string): string {
  const context = spec.context?.trim();
  return context ? `Task:\n${task}\n\nContext:\n${context}` : task;
}
