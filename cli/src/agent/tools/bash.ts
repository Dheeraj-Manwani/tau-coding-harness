import { spawn } from "node:child_process";
import type { Tool } from "./types.ts";

const DEFAULT_TIMEOUT = 120_000;
const MAX_OUTPUT = 30_000;

function clamp(text: string): string {
  if (text.length <= MAX_OUTPUT) return text;
  const head = text.slice(0, MAX_OUTPUT);
  return `${head}\n… (output truncated, ${text.length - MAX_OUTPUT} more characters)`;
}

export const bashTool: Tool = {
  name: "bash",
  description:
    "Run a shell command in the project directory and return its combined " +
    "stdout/stderr and exit code. Use for builds, tests, git, and inspecting " +
    "the project (ls, grep, cat). Commands run in the platform's default shell.",
  mutating: true,
  schema: {
    type: "object",
    properties: {
      command: { type: "string", description: "The shell command to execute." },
      timeout: { type: "number", description: `Timeout in ms (default ${DEFAULT_TIMEOUT}).` },
    },
    required: ["command"],
  },
  summarize: (input) => `bash: ${String(input.command).split("\n")[0]}`,
  run(input, ctx) {
    const timeout = Math.min(input.timeout ?? DEFAULT_TIMEOUT, 600_000);
    return new Promise<string>((resolvePromise) => {
      const child = spawn(input.command, {
        cwd: ctx.cwd,
        shell: true,
        windowsHide: true,
      });

      let out = "";
      let killed = false;
      const timer = setTimeout(() => {
        killed = true;
        child.kill();
      }, timeout);

      child.stdout?.on("data", (d) => (out += d.toString()));
      child.stderr?.on("data", (d) => (out += d.toString()));

      child.on("error", (e) => {
        clearTimeout(timer);
        resolvePromise(`Failed to start command: ${e.message}`);
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        const body = clamp(out.trim() || "(no output)");
        if (killed) {
          resolvePromise(`Command timed out after ${timeout}ms.\n${body}`);
        } else {
          resolvePromise(`Exit code: ${code ?? 0}\n${body}`);
        }
      });
    });
  },
};
