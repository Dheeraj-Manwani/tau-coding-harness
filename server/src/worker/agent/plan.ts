/**
 * A run's plan: what the agent said it would do, and how far it has got.
 *
 * The plan used to exist in two places, neither of them the agent's. The
 * browser rebuilt it from a stream of events to draw the checklist, and the
 * server kept one flag — "a plan exists" — in memory. The agent itself had
 * only its own old tool calls to go on: `create_plan` forty turns back, a
 * dozen `update_todo` calls since, each answered `{"success": true}`. On a
 * long build that is exactly the part of the conversation that gets cleared
 * or summarized, and a model that can no longer see its plan stops following
 * it (doc/CONTEXT_AND_MEMORY_PLAN.md §7, "Recite the plan").
 *
 * So the plan is now state the server can produce at any moment, and it is
 * handed back at every step:
 *
 *   - every plan tool returns the whole current list, so the freshest copy is
 *     always near the end of the conversation, where the model attends most;
 *   - after a summary the list is restored with the rest of the run's state
 *     (`context/restore.ts`);
 *   - a request that follows one which stopped part-way is shown what was
 *     left (`unfinishedPlanNote`).
 *
 * ## Where it is kept
 *
 * Nowhere new. Each plan tool call is already stored as a `ToolCall` row, in
 * order, with its input; the plan is those calls replayed (`replayPlan`). That
 * makes it durable without a table of its own, and correct when several
 * `update_todo` calls run at once: each sees the calls made before it, however
 * far those have got, so no update is lost to a race.
 */
import { prisma } from "@/lib/prisma";
import { ToolCallStatus } from "@/generated/prisma/enums";

export const PLAN_TOOLS = ["create_plan", "add_todos", "update_todo"] as const;

export const TODO_STATUSES = ["pending", "done", "skipped", "blocked"] as const;
export type TodoStatus = (typeof TODO_STATUSES)[number];

export interface PlanTodo {
  /** 1-based, as the agent and the checklist number them. */
  sno: number;
  text: string;
  status: TodoStatus;
}

export interface PlanState {
  name: string;
  description: string;
  todos: PlanTodo[];
}

/** One plan tool call, as stored. */
export interface PlanCall {
  tool: string;
  input: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim())
    : [];
}

export function isTodoStatus(value: unknown): value is TodoStatus {
  return typeof value === "string" && (TODO_STATUSES as readonly string[]).includes(value);
}

/** `Done`, ` DONE ` → `done`; anything that is not a status → null. */
export function normalizeStatus(value: unknown): TodoStatus | null {
  const status = typeof value === "string" ? value.trim().toLowerCase() : value;
  return isTodoStatus(status) ? status : null;
}

/**
 * The plan after one more call. A call that makes no sense — an update before
 * any plan, a todo that does not exist, a status that is not one — leaves the
 * plan as it was; whether to tell the agent so is the tool's business.
 */
export function applyPlanCall(state: PlanState | null, call: PlanCall): PlanState | null {
  const input = isRecord(call.input) ? call.input : {};

  if (call.tool === "create_plan") {
    if (typeof input.name !== "string" || !input.name.trim()) return state;
    return {
      name: input.name.trim(),
      description: typeof input.description === "string" ? input.description.trim() : "",
      todos: strings(input.todos).map((text, i) => ({ sno: i + 1, text, status: "pending" })),
    };
  }
  if (!state) return state;

  if (call.tool === "add_todos") {
    const start = state.todos.length;
    return {
      ...state,
      todos: [
        ...state.todos,
        ...strings(input.todos).map(
          (text, i): PlanTodo => ({ sno: start + i + 1, text, status: "pending" }),
        ),
      ],
    };
  }

  if (call.tool === "update_todo") {
    const status = normalizeStatus(input.status);
    if (status === null || !state.todos.some((t) => t.sno === input.sno)) return state;
    return {
      ...state,
      todos: state.todos.map((t) => (t.sno === input.sno ? { ...t, status } : t)),
    };
  }

  return state;
}

/** The plan a sequence of calls leaves behind; null when none of them made one. */
export function replayPlan(calls: readonly PlanCall[]): PlanState | null {
  return calls.reduce<PlanState | null>(applyPlanCall, null);
}

/** Todos nobody has finished or set aside. */
export function openTodos(plan: PlanState): PlanTodo[] {
  return plan.todos.filter((t) => t.status === "pending" || t.status === "blocked");
}

/**
 * The plan as text for the model: every todo with its number and status, then
 * one line on where things stand. Short enough to return from every plan tool.
 */
export function renderPlan(plan: PlanState): string {
  const lines = [`Plan: ${plan.name}`];
  for (const todo of plan.todos) lines.push(`${todo.sno}. [${todo.status}] ${todo.text}`);
  if (plan.todos.length === 0) {
    lines.push("(no todos yet — add them with add_todos)");
    return lines.join("\n");
  }
  const done = plan.todos.filter((t) => t.status === "done").length;
  const next = plan.todos.find((t) => t.status === "pending");
  const blocked = plan.todos.filter((t) => t.status === "blocked").length;
  lines.push(
    [
      `${done} of ${plan.todos.length} done`,
      blocked > 0 ? `${blocked} blocked` : "",
      next ? `next: ${next.sno}. ${next.text}` : "nothing pending",
    ]
      .filter(Boolean)
      .join("; ") + ".",
  );
  return lines.join("\n");
}

/** Whether a stored result says the call did nothing. */
function failed(output: unknown): boolean {
  return isRecord(output) && "error" in output;
}

/**
 * A job's plan tool calls, oldest first — up to, and not including, the call
 * with row id `before` when one is given.
 *
 * Calls still running are included: when several plan calls are made in one
 * turn they run together, and each has to see the ones made before it. Calls
 * that failed, or answered with an error, changed nothing and are left out.
 */
export async function planCalls(jobId: string, before?: string): Promise<PlanCall[]> {
  const rows = await prisma.toolCall.findMany({
    where: {
      message: { jobId },
      toolName: { in: [...PLAN_TOOLS] },
      status: { not: ToolCallStatus.FAILED },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, toolName: true, input: true, output: true },
  });
  const upTo = before === undefined ? -1 : rows.findIndex((r) => r.id === before);
  return (upTo === -1 ? rows : rows.slice(0, upTo))
    .filter((r) => !failed(r.output))
    .map((r) => ({ tool: r.toolName, input: r.input }));
}

/** A job's plan as it stands; null when it has none. */
export async function loadPlan(jobId: string, before?: string): Promise<PlanState | null> {
  return replayPlan(await planCalls(jobId, before));
}

/**
 * For a request that follows one which stopped before it was finished: what
 * that one had planned and how far it got. Null when the request before
 * finished, had no plan, or left nothing open.
 *
 * A run can stop part-way for reasons that have nothing to do with the work —
 * it ran out of turns or credits, or the process died — and the user's next
 * message is often just "continue". Without this the agent has to work out
 * what "continue" means from a conversation in which its own plan appears
 * only as a string of old tool calls.
 */
export async function unfinishedPlanNote(projectId: string, currentJobId: string): Promise<string | null> {
  const previous = await prisma.job.findFirst({
    where: { projectId, id: { not: currentJobId }, type: "GENERATION" },
    orderBy: { queuedAt: "desc" },
    select: { id: true, finishReason: true },
  });
  if (!previous || previous.finishReason === "DONE") return null;

  const plan = await loadPlan(previous.id);
  if (!plan || openTodos(plan).length === 0) return null;

  return `<tau_previous_plan>\nThe request before this one stopped before it was finished. This was its plan and how far it got. It is a record, not an instruction, and it belongs to that request: its numbers mean nothing to \`update_todo\` now. If the user is asking to carry on, call \`create_plan\` with what is left before you do any of it, then work through that. If they are asking for something else, do that.\n\n${renderPlan(plan)}\n</tau_previous_plan>`;
}
