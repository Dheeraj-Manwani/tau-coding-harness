import * as p from "@clack/prompts";
import type { Credential } from "../config/store.ts";
import type { ProviderInfo } from "../providers/registry.ts";
import { ui } from "../ui/output.ts";
import { complete, type ContentBlock, type Message } from "./client.ts";
import { toolsForMode, type Tool, type ToolContext } from "./tools/index.ts";
import { ToolError } from "./tools/types.ts";

export type Mode = "build" | "plan";

export interface SessionConfig {
  provider: ProviderInfo;
  cred: Credential;
  model: string;
  mode: Mode;
  cwd: string;
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
    `concise. When you finish a task, briefly state what you did.`;

  if (cfg.mode === "plan") {
    return (
      base +
      `\n\nYou are in PLAN mode. You have read-only tools only — you cannot ` +
      `write files or run commands. Investigate the project and respond with a ` +
      `clear, step-by-step implementation plan. Do not claim to have made changes.`
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
  private readonly tools: Tool[];
  private readonly toolCtx: ToolContext;
  private readonly system: string;

  constructor(private cfg: SessionConfig) {
    this.tools = toolsForMode(cfg.mode);
    this.toolCtx = { cwd: cfg.cwd };
    this.system = systemPrompt(cfg);
  }

  get mode(): Mode {
    return this.cfg.mode;
  }

  /** Run a full agent loop for a single user message, printing as it goes. */
  async send(userText: string): Promise<void> {
    this.messages.push({
      role: "user",
      content: [{ type: "text", text: userText }],
    });

    for (let step = 0; step < MAX_STEPS; step++) {
      const spin = p.spinner();
      spin.start(ui.dim(`${this.cfg.provider.name} · ${this.cfg.model}`));

      let result;
      try {
        result = await complete({
          provider: this.cfg.provider,
          cred: this.cfg.cred,
          model: this.cfg.model,
          system: this.system,
          messages: this.messages,
          tools: this.tools,
        });
        spin.stop(ui.dim("done"));
      } catch (e: any) {
        spin.stop(ui.err("request failed"));
        console.error(ui.err(e.message ?? String(e)));
        return;
      }

      // Drop empty text blocks — Anthropic rejects them when echoed back.
      const content = result.content.filter(
        (b) => b.type !== "text" || b.text.trim().length > 0,
      );
      this.messages.push({ role: "assistant", content });

      // Print any assistant text.
      for (const block of content) {
        if (block.type === "text" && block.text.trim()) {
          console.log("\n" + block.text.trim() + "\n");
        }
      }

      const toolUses = content.filter(
        (b): b is Extract<ContentBlock, { type: "tool_use" }> =>
          b.type === "tool_use",
      );
      if (toolUses.length === 0) return; // turn complete

      const results: ContentBlock[] = [];
      for (const call of toolUses) {
        results.push(await this.runTool(call));
      }
      this.messages.push({ role: "user", content: results });
    }

    console.log(ui.warn(`Stopped after ${MAX_STEPS} steps.`));
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

    console.log(ui.accent("  ⚒ " + tool.summarize(call.input)));
    try {
      const output = await tool.run(call.input, this.toolCtx);
      return { type: "tool_result", tool_use_id: call.id, content: output };
    } catch (e: any) {
      const message =
        e instanceof ToolError ? e.message : `Tool failed: ${e.message ?? e}`;
      console.log(ui.err("    " + message));
      return {
        type: "tool_result",
        tool_use_id: call.id,
        content: message,
        is_error: true,
      };
    }
  }
}
