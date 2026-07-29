import type { ReplayEvent } from "@/src/features/marketing/data/replay";

/**
 * Folds a recorded SSE stream into the three panes of the workspace mock.
 *
 * This is a deliberately narrower reducer than the app's `useProjectStore`:
 * that one has to survive reconnects, out-of-order delivery, resyncs and manual
 * edits. A replay is a finished, ordered recording, so all of that machinery
 * would be dead weight in the marketing chunk. What it must keep is fidelity to
 * the same event union, so the mock cannot drift from what the product emits.
 */

export interface ReplayTodo {
  text: string;
  done: boolean;
}

export interface ReplayMessage {
  role: "user" | "assistant";
  text: string;
}

export interface ReplayView {
  messages: ReplayMessage[];
  /** Whatever the agent last said it was doing, until it says something else. */
  thinking: string | null;
  planName: string | null;
  todos: ReplayTodo[];
  /** Paths in the order the agent created them. */
  files: string[];
  activeFile: string | null;
  activeFileContent: string;
  shell: string[];
  previewUrl: string | null;
  finished: boolean;
}

/** Only the tail of the shell is ever visible; keeping more is just memory. */
const SHELL_LINES = 6;

export function emptyView(): ReplayView {
  return {
    messages: [],
    thinking: null,
    planName: null,
    todos: [],
    files: [],
    activeFile: null,
    activeFileContent: "",
    shell: [],
    previewUrl: null,
    finished: false,
  };
}

/** Applies one event in place. The caller owns the object and its lifetime. */
export function applyReplayEvent(view: ReplayView, entry: ReplayEvent): void {
  const event = entry.event;

  switch (event.type) {
    case "thinking":
      view.thinking = event.message;
      break;

    case "llm_chunk": {
      const last = view.messages[view.messages.length - 1];
      if (last && last.role === "assistant") {
        last.text += event.content;
      } else {
        view.messages.push({ role: "assistant", text: event.content });
      }
      view.thinking = null;
      break;
    }

    case "plan_created":
      view.planName = event.name;
      view.todos = event.todos.map((text) => ({ text, done: false }));
      break;

    case "todos_added":
      view.todos = [
        ...view.todos,
        ...event.todos.map((text) => ({ text, done: false })),
      ];
      break;

    case "todo_updated": {
      // `sno` is 1-based in the product's tool contract.
      const todo = view.todos[event.sno - 1];
      if (todo) todo.done = /done|complete/i.test(event.status);
      break;
    }

    case "file_start":
      if (!view.files.includes(event.path)) view.files.push(event.path);
      view.activeFile = event.path;
      view.activeFileContent = "";
      break;

    case "file_chunk":
      if (view.activeFile !== event.path) {
        // A chunk for a file we never saw start still belongs on screen.
        if (!view.files.includes(event.path)) view.files.push(event.path);
        view.activeFile = event.path;
        view.activeFileContent = "";
      }
      view.activeFileContent += event.content;
      break;

    case "file_delete":
      view.files = view.files.filter((path) => path !== event.path);
      if (view.activeFile === event.path) {
        view.activeFile = null;
        view.activeFileContent = "";
      }
      break;

    case "shell_output":
      view.shell.push(event.line);
      if (view.shell.length > SHELL_LINES) view.shell.shift();
      break;

    case "preview_ready":
      view.previewUrl = event.url;
      break;

    case "done":
    case "cancelled":
      view.finished = true;
      view.thinking = null;
      break;

    // Everything else — tool plumbing, credit ledger updates, context
    // compaction, errors — is real but not part of the story this band tells.
    default:
      break;
  }
}

/**
 * A detached copy, safe to hand to React.
 *
 * `applyReplayEvent` mutates — it appends to the last assistant message, ticks
 * a todo, pushes a shell line — so the accumulator can never itself be state.
 * Everything the panes read is copied here, and everything else is a primitive.
 */
export function snapshotView(view: ReplayView): ReplayView {
  return {
    ...view,
    messages: view.messages.map((message) => ({ ...message })),
    todos: view.todos.map((todo) => ({ ...todo })),
    files: [...view.files],
    shell: [...view.shell],
  };
}

/** Replays from the start up to `timeMs`. Used on mount and when scrubbing back. */
export function viewAt(events: ReplayEvent[], timeMs: number): ReplayView {
  const view = emptyView();
  for (const entry of events) {
    if (entry.at > timeMs) break;
    applyReplayEvent(view, entry);
  }
  return view;
}
