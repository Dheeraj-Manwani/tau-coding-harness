import { EventEmitter } from "node:events";
import type { AgentReporter } from "../agent/loop.ts";
import type { SessionInteraction } from "../agent/session.ts";

/**
 * One thing that happened in the agent loop or an interaction request, pushed
 * from the agent core out to the React layer. The `<App>` subscribes to the
 * bridge's single `"event"` channel and folds these into transcript state.
 */
export type TuiEvent =
  | { type: "step-begin" }
  | { type: "text"; delta: string }
  | { type: "step-end" }
  | { type: "model-error"; message: string }
  | { type: "tools-begin" }
  | { type: "tool-begin"; toolName: string; summary: string }
  | {
      type: "tool-done";
      toolName: string;
      summary: string;
      output: string;
      isError: boolean;
    }
  | { type: "exhausted"; maxSteps: number }
  // Interaction requests: the App renders an overlay and answers via resolve().
  | { type: "confirm"; id: number; message: string }
  | { type: "select"; id: number; question: string; options?: string[] };

/**
 * The seam between the (synchronous, stdout-free) agent core and the Ink UI.
 *
 * It exposes an {@link AgentReporter} and a {@link SessionInteraction} to hand
 * to a {@link Session}; both turn calls into `"event"` emissions. Interaction
 * calls also park a Promise resolver keyed by id, so the App can answer an
 * overlay later via {@link resolve}. Nothing here touches the terminal — Ink
 * owns the screen.
 */
export class TuiBridge extends EventEmitter {
  private nextId = 1;
  private readonly pending = new Map<number, (value: never) => void>();

  /** Subscribe to loop/interaction events. Returns an unsubscribe function. */
  onEvent(listener: (event: TuiEvent) => void): () => void {
    this.on("event", listener);
    return () => this.off("event", listener);
  }

  private push(event: TuiEvent): void {
    this.emit("event", event);
  }

  readonly reporter: AgentReporter = {
    beginStep: () => this.push({ type: "step-begin" }),
    onText: (delta) => this.push({ type: "text", delta }),
    endStep: () => this.push({ type: "step-end" }),
    modelError: (message) => this.push({ type: "model-error", message }),
    beginTools: () => this.push({ type: "tools-begin" }),
    beginTool: (toolName, summary) =>
      this.push({ type: "tool-begin", toolName, summary }),
    toolDone: (toolName, summary, output, isError) =>
      this.push({ type: "tool-done", toolName, summary, output, isError }),
    exhausted: (maxSteps) => this.push({ type: "exhausted", maxSteps }),
  };

  readonly interaction: SessionInteraction = {
    confirm: (message) =>
      this.request<boolean>((id) => this.push({ type: "confirm", id, message })),
    promptUser: (question, options) =>
      this.request<string | null>((id) =>
        this.push({ type: "select", id, question, options }),
      ),
  };

  /** Park a resolver under a fresh id and emit the request that carries it. */
  private request<T>(emit: (id: number) => void): Promise<T> {
    return new Promise<T>((resolve) => {
      const id = this.nextId++;
      this.pending.set(id, resolve as (value: never) => void);
      emit(id);
    });
  }

  /** Answer a pending interaction request (from an overlay). No-op if stale. */
  resolve(id: number, value: boolean | string | null): void {
    const resolver = this.pending.get(id);
    if (!resolver) return;
    this.pending.delete(id);
    resolver(value as never);
  }
}
