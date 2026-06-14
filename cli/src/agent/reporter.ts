import { createLiveText, type LiveText } from "../ui/live.ts";
import type { Spinner } from "../ui/spinner.ts";
import { tau } from "../ui/tau.ts";
import type { AgentReporter } from "./loop.ts";

/**
 * Drives the terminal UI for a top-level session's agent loop: a pinned spinner
 * while the model thinks, live-then-rendered markdown for streamed text, and a
 * compact `⚒` line per tool call. Owns the per-step live-text region; the
 * spinner is created and torn down by the {@link Session} (which also shares it
 * with user prompts), so this only pauses/resumes it.
 */
export class TerminalReporter implements AgentReporter {
  private live: LiveText | null = null;
  private streaming = false;

  constructor(private readonly spin: Spinner) {}

  beginStep(): void {
    this.spin.setText("Thinking");
    this.spin.resume();
    this.live = createLiveText();
    this.streaming = false;
  }

  onText(delta: string): void {
    // On the first token the pinned spinner steps aside so the raw stream can
    // own the bottom line; endStep() then erases it and reprints as markdown.
    if (!this.streaming) {
      this.streaming = true;
      this.spin.pause();
    }
    this.live?.push(delta);
  }

  endStep(): void {
    this.live?.finish();
    this.live = null;
  }

  modelError(message: string): void {
    this.spin.pause();
    tau.error(message);
  }

  beginTools(): void {
    this.spin.resume();
  }

  toolDone(
    toolName: string,
    summary: string,
    output: string,
    isError: boolean,
  ): void {
    if (isError) {
      tau.tool(summary, "failed");
      tau.error(output);
    } else {
      tau.tool(summary, briefResult(toolName, output));
    }
  }

  exhausted(maxSteps: number): void {
    tau.error(`Stopped after ${maxSteps} steps.`);
  }
}

/** A reporter that prints nothing — used for headless sub-agents, whose work is
 *  surfaced to the user via the parent's dispatch-tool line instead. */
export class SilentReporter implements AgentReporter {
  beginStep(): void {}
  onText(): void {}
  endStep(): void {}
  modelError(): void {}
  beginTools(): void {}
  toolDone(): void {}
  exhausted(): void {}
}

/** A short, human-readable result note for a tool call — never the raw output. */
function briefResult(toolName: string, output: string): string {
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
