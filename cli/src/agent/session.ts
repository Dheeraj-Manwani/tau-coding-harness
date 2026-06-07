import { isAbsolute, relative, resolve } from "node:path";
import * as p from "@clack/prompts";
import type { Credential } from "../config/store.ts";
import type { ProviderInfo } from "../providers/registry.ts";
import { createSpinner, type Spinner } from "../ui/spinner.ts";
import { tau } from "../ui/tau.ts";
import { createLiveText } from "../ui/live.ts";
import { createClient } from "../providers/registry.ts";
import type {
  ContentBlock,
  Message,
  ProviderClient,
} from "../providers/types.ts";
import { toolsForMode, type Tool, type ToolContext } from "./tools/index.ts";
import {
  ToolError,
  type AgentMode,
  type ModeSwitchResult,
} from "./tools/types.ts";

export type Mode = "build" | "plan";

export interface SessionConfig {
  provider: ProviderInfo;
  cred: Credential;
  model: string;
  mode: Mode;
  cwd: string;
  maxTokens?: number;
}

/** Hard cap on tool-call iterations per user turn, to avoid runaway loops. */
const MAX_STEPS = 50;

/** Human-friendly OS label and the default shell for a Node platform code. */
function platformInfo(): { os: string; shell: string } {
  switch (process.platform) {
    case "win32":
      return { os: "Windows", shell: "PowerShell" };
    case "darwin":
      return { os: "macOS", shell: "zsh/bash" };
    case "linux":
      return { os: "Linux", shell: "bash" };
    default:
      return { os: process.platform, shell: "POSIX shell" };
  }
}

function systemPrompt(cfg: SessionConfig): string {
  const { os, shell } = platformInfo();
  const base =
    `You are tau, a coding agent operating in the user's terminal.\n` +
    `Working directory: ${cfg.cwd}\n` +
    `Platform: ${os} (${process.platform}), default shell: ${shell}\n` +
    `Write shell commands and file paths in the syntax appropriate for this ` +
    `platform.\n\n` +
    `Use the provided tools to inspect and modify the project. Keep prose ` +
    `concise. When you finish a task, briefly state what you did.\n\n` +
    `Conventions - match the project before you change it:\n` +
    `- Package manager: detect it from the lockfile before installing, adding, ` +
    `or removing dependencies, and use only that one. bun.lock / bun.lockb → ` +
    `bun; pnpm-lock.yaml → pnpm; yarn.lock → yarn; package-lock.json → npm. ` +
    `If none exists, default to npm.\n`;

  if (cfg.mode === "plan") {
    return (
      base +
      `\n\nYou are in PLAN mode. Investigate the project read-only and produce ` +
      `a clear, step-by-step implementation plan. You may NOT edit existing ` +
      `files or run shell commands, and you must not change any project source ` +
      `code. Do not claim to have implemented anything.\n\n` +
      `Save the finished plan as a markdown file under \`tau/plans/\` in the ` +
      `project root (create the folder if it doesn't exist) using the \`write\` ` +
      `tool — this is the ONLY place you may write. Name the file in kebab-case ` +
      `after the task, e.g. \`tau/plans/add-user-auth.md\`. The file should ` +
      `contain the full plan in well-structured markdown (a title, a short ` +
      `summary, then the numbered steps). After saving, tell the user the path ` +
      `to the plan file.\n\n` +
      `If the user asks you to build, implement, or execute the plan, you ` +
      `cannot edit project files or run commands while in plan mode. Use the ` +
      `\`switch_mode\` tool to request switching to build mode (the user must ` +
      `confirm); once switched, carry out the work. The user can also switch ` +
      `manually by typing \`/build\`.`
    );
  }
  return (
    base +
    `\n\nYou are in BUILD mode. You may read, write, and edit files and run ` +
    `shell commands to complete the task.`
  );
}

export class Session {
  readonly messages: Message[] = [];
  // Re-derived whenever the mode changes (see applyMode), so a mid-turn
  // switch_mode takes effect on the next loop iteration.
  private tools!: Tool[];
  private system!: string;
  private readonly toolCtx: ToolContext;
  private readonly client: ProviderClient;
  // The spinner owning the bottom line during an active turn, so a mode-switch
  // confirmation prompt can step aside without fighting it for the terminal.
  private spin: Spinner | null = null;

  constructor(private cfg: SessionConfig) {
    this.toolCtx = {
      cwd: cfg.cwd,
      requestModeSwitch: (target, reason) =>
        this.requestModeSwitch(target, reason),
    };
    this.client = createClient(cfg.provider, cfg.cred);
    this.applyMode(cfg.mode);
  }

  get mode(): Mode {
    return this.cfg.mode;
  }

  /**
   * Re-derive everything that depends on the operating mode: the tool set, the
   * system prompt, and the plan-mode write guard. Called from the constructor
   * and on an accepted mode switch.
   */
  private applyMode(mode: Mode): void {
    this.cfg = { ...this.cfg, mode };
    this.tools = toolsForMode(mode);
    this.system = systemPrompt(this.cfg);
    // Plan mode may only write its plan document; hard-enforce that the `write`
    // tool can't escape tau/plans/ into project source files.
    this.toolCtx.assertWritable =
      mode === "plan" ? planWriteGuard(this.cfg.cwd) : undefined;
  }

  /**
   * Ask the user to confirm switching to `target` mode. Only changes mode if
   * they accept. Pauses the live spinner around the prompt so clack owns the
   * terminal cleanly. Implements {@link ToolContext.requestModeSwitch}.
   */
  private async requestModeSwitch(
    target: AgentMode,
    reason?: string,
  ): Promise<ModeSwitchResult> {
    if (target === this.cfg.mode) {
      return { switched: false, mode: this.cfg.mode };
    }

    const spin = this.spin;
    spin?.pause();
    let accepted: boolean;
    try {
      const answer = await p.confirm({
        message:
          `Switch to ${target} mode?` + (reason ? ` (${reason})` : ""),
      });
      // isCancel (Ctrl+C) and an explicit "no" both count as declining.
      accepted = answer === true;
    } finally {
      spin?.resume();
    }

    if (!accepted) {
      return { switched: false, mode: this.cfg.mode };
    }
    this.applyMode(target);
    return { switched: true, mode: target };
  }

  /** Run a full agent loop for a single user message, printing as it goes. */
  async send(userText: string): Promise<void> {
    this.messages.push({
      role: "user",
      content: [{ type: "text", text: userText }],
    });

    const spin = createSpinner("Thinking");
    this.spin = spin;
    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        spin.setText("Thinking");
        spin.resume();

        // Stream raw tokens live for instant feedback; on the first token the
        // pinned spinner steps aside. Once the reply is complete the raw text is
        // erased and reprinted as rendered markdown (see createLiveText).
        const live = createLiveText();
        let streaming = false;
        const onText = (delta: string): void => {
          if (!streaming) {
            streaming = true;
            spin.pause();
          }
          live.push(delta);
        };

        let result;
        try {
          result = await this.client.chat(
            {
              model: this.cfg.model,
              system: this.system,
              messages: this.messages,
              tools: this.tools,
              maxTokens: this.cfg.maxTokens,
            },
            { onText },
          );
        } catch (e: any) {
          spin.pause();
          tau.error(e.message ?? String(e));
          return;
        }

        // Replace the streamed raw text with rendered markdown, set off by blank
        // lines so it's visually distinct from the surrounding tool-call lines.
        live.finish();

        // Drop empty text blocks — providers reject them when echoed back.
        const content = result.content.filter(
          (b) => b.type !== "text" || b.text.trim().length > 0,
        );
        this.messages.push({ role: "assistant", content });

        const toolUses = content.filter(
          (b): b is Extract<ContentBlock, { type: "tool_use" }> =>
            b.type === "tool_use",
        );
        if (toolUses.length === 0) return; // turn complete

        spin.resume();
        const results: ContentBlock[] = [];
        for (const call of toolUses) {
          results.push(await this.runTool(call));
        }
        this.messages.push({ role: "user", content: results });
      }

      tau.error(`Stopped after ${MAX_STEPS} steps.`);
    } finally {
      spin.stop();
      this.spin = null;
    }
  }

  private async runTool(
    call: Extract<ContentBlock, { type: "tool_use" }>,
  ): Promise<ContentBlock> {
    const tool = this.tools.find((t) => t.name === call.name);
    if (!tool) {
      return {
        type: "tool_result",
        tool_use_id: call.id,
        content: `Unknown tool: ${call.name}`,
        is_error: true,
      };
    }

    const summary = tool.summarize(call.input);
    try {
      const output = await tool.run(call.input, this.toolCtx);
      // Show the call and a brief result note; never echo the raw output.
      tau.tool(summary, briefResult(tool.name, output));
      return { type: "tool_result", tool_use_id: call.id, content: output };
    } catch (e: any) {
      const message =
        e instanceof ToolError ? e.message : `Tool failed: ${e.message ?? e}`;
      tau.tool(summary, "failed");
      tau.error(message);
      return {
        type: "tool_result",
        tool_use_id: call.id,
        content: message,
        is_error: true,
      };
    }
  }
}

/**
 * Build a write guard for plan mode: refuse any write whose resolved path is
 * outside `<cwd>/tau/plans`. This is the hard backstop behind the plan-mode
 * prompt, so the agent can save its plan but cannot touch project files.
 */
function planWriteGuard(cwd: string): (absPath: string) => void {
  const plansDir = resolve(cwd, "tau", "plans");
  return (absPath: string): void => {
    const rel = relative(plansDir, absPath);
    const inside = rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
    if (!inside) {
      throw new ToolError(
        `Plan mode can only write inside tau/plans/. Refusing to write ` +
          `${absPath}. Switch to build mode (/build) to modify project files.`,
      );
    }
  };
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
    default:
      return "done";
  }
}
