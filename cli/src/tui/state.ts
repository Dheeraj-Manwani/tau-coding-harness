import type { TuiEvent } from "./bridge.ts";

/** A single rendered row in the transcript. */
export type Entry =
  | { kind: "user"; text: string }
  /** `gap` adds a blank line above — set when this text follows tool calls. */
  | { kind: "assistant"; text: string; streaming: boolean; gap?: boolean }
  | { kind: "tool"; summary: string; result?: string }
  | { kind: "tool-error"; summary: string; output: string }
  | { kind: "error"; text: string }
  /** Local notices: slash-command output, mode switches, etc. */
  | { kind: "notice"; text: string };

export interface TuiState {
  entries: Entry[];
  /** A turn is in flight (model thinking / tools running). Drives the status line. */
  busy: boolean;
  /** Label shown by the status line — "Thinking" between steps, or a verb phrase
   *  for the tool currently running (e.g. "Writing to Readme"). */
  statusLabel: string;
  /** Index of the assistant entry currently being streamed, or null. */
  streamingIndex: number | null;
}

export const initialState: TuiState = {
  entries: [],
  busy: false,
  statusLabel: "Thinking",
  streamingIndex: null,
};

/** Local (user-driven) actions, alongside the agent-loop {@link TuiEvent}s. */
export type Action =
  | TuiEvent
  | { type: "submit-user"; text: string }
  | { type: "notice"; text: string }
  | { type: "turn-done" }
  | { type: "clear" };

/**
 * Fold one action into the transcript state. Pure — no I/O — so it can be unit
 * tested and React can call it from `useReducer`. The streaming assistant entry
 * is created lazily on the first text delta (a step may produce only tool
 * calls), and finalized on `step-end`.
 */
export function reducer(state: TuiState, action: Action): TuiState {
  switch (action.type) {
    case "submit-user":
      return {
        ...state,
        entries: [...state.entries, { kind: "user", text: action.text }],
      };

    case "step-begin":
      // A new model step: back to "Thinking" until the next tool runs.
      return { ...state, busy: true, statusLabel: "Thinking" };

    case "text": {
      const { streamingIndex, entries } = state;
      if (streamingIndex === null) {
        // Open a fresh assistant entry for this step's text. If it follows tool
        // output, mark a gap so a blank line separates the tools from the reply.
        const prev = entries[entries.length - 1];
        const gap = prev?.kind === "tool" || prev?.kind === "tool-error";
        return {
          ...state,
          streamingIndex: entries.length,
          entries: [
            ...entries,
            { kind: "assistant", text: action.delta, streaming: true, gap },
          ],
        };
      }
      const next = entries.slice();
      const cur = next[streamingIndex];
      if (cur && cur.kind === "assistant") {
        next[streamingIndex] = { ...cur, text: cur.text + action.delta };
      }
      return { ...state, entries: next };
    }

    case "step-end": {
      const { streamingIndex, entries } = state;
      if (streamingIndex === null) return state;
      const next = entries.slice();
      const cur = next[streamingIndex];
      if (cur && cur.kind === "assistant") {
        next[streamingIndex] = { ...cur, streaming: false };
      }
      return { ...state, entries: next, streamingIndex: null };
    }

    case "tools-begin":
      return state;

    case "tool-begin":
      // Reflect the running tool in the status line, e.g. "Writing to Readme".
      return { ...state, statusLabel: statusLabel(action.toolName, action.summary) };

    case "tool-done":
      return {
        ...state,
        entries: [
          ...state.entries,
          action.isError
            ? { kind: "tool-error", summary: action.summary, output: action.output }
            : {
                kind: "tool",
                summary: action.summary,
                result: briefResult(action.toolName, action.output),
              },
        ],
      };

    case "model-error":
      return {
        ...state,
        entries: [...state.entries, { kind: "error", text: action.message }],
      };

    case "exhausted":
      return {
        ...state,
        entries: [
          ...state.entries,
          { kind: "error", text: `Stopped after ${action.maxSteps} steps.` },
        ],
      };

    case "notice":
      return {
        ...state,
        entries: [...state.entries, { kind: "notice", text: action.text }],
      };

    case "turn-done":
      return { ...state, busy: false, statusLabel: "Thinking", streamingIndex: null };

    case "clear":
      return { ...initialState };

    // Interaction requests are handled by the App (overlays), not the reducer.
    case "confirm":
    case "select":
      return state;
  }
}

/**
 * A present-tense status-line label for the tool currently running — e.g.
 * `write README.md` becomes "Writing to Readme". The target name is pulled from
 * the tool's `summary` (everything after its leading verb), reduced to a tidy
 * file stem; tools without a meaningful target get a bare verb phrase.
 */
export function statusLabel(toolName: string, summary: string): string {
  const target = () => prettyTarget(summary);
  switch (toolName) {
    case "read":
      return `Reading ${target()}`;
    case "write":
      return `Writing to ${target()}`;
    case "edit":
      return `Editing ${target()}`;
    case "bash":
      return "Running command";
    case "switch_mode":
      return "Switching mode";
    case "prompt_user":
      return "Waiting for you";
    case "dispatch_search_agent":
      return "Searching";
    case "dispatch_review_agent":
      return "Reviewing";
    case "dispatch_code_agent":
      return "Writing code";
    default:
      return "Working";
  }
}

/**
 * Turn a tool summary like `write src/README.md` into a tidy display name
 * ("Readme"): take the text after the leading verb, keep only the file's base
 * name, drop the extension, and title-case it.
 */
function prettyTarget(summary: string): string {
  const space = summary.indexOf(" ");
  const rest = (space === -1 ? summary : summary.slice(space + 1)).trim();
  const base = rest.split(/[\\/]/).pop() ?? rest;
  const stem = base.replace(/\.[^.]+$/, "") || base;
  return stem.charAt(0).toUpperCase() + stem.slice(1).toLowerCase();
}

/**
 * A short, human-readable note for a finished tool call — never the raw output.
 * Mirrors the terminal reporter's `briefResult` so both front-ends read alike.
 */
export function briefResult(toolName: string, output: string): string {
  switch (toolName) {
    case "read": {
      const lines = output.split("\n").length;
      return `${lines} line${lines === 1 ? "" : "s"}`;
    }
    case "bash": {
      const m = output.match(/^Exit code: (\d+)/);
      return m ? `exit ${m[1]}` : "done";
    }
    case "switch_mode":
      return output.startsWith("Switched") ? "switched" : "declined";
    case "prompt_user":
      return output.startsWith("The user dismissed") ? "dismissed" : "answered";
    case "dispatch_search_agent":
    case "dispatch_review_agent":
    case "dispatch_code_agent":
      return "returned";
    default:
      return "done";
  }
}
