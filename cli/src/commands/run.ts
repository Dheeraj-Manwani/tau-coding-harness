import * as p from "@clack/prompts";
import type { Command } from "commander";
import { resolve } from "node:path";
import { readConfig } from "../config/store.ts";
import { Session, type Mode, type SessionConfig } from "../agent/session.ts";
import { resolveTarget, ResolveError } from "./context.ts";
import { printError, ui } from "../ui/output.ts";
import { launchTui } from "../tui/index.tsx";

interface RunOptions {
  model?: string;
  provider?: string;
  plan?: boolean;
  build?: boolean;
  cwd?: string;
  once?: boolean;
  maxTokens?: string;
  /** `--no-tui` sets this false to use the legacy line-based REPL. */
  tui?: boolean;
}

async function run(promptParts: string[], opts: RunOptions): Promise<void> {
  const cfg = await readConfig();
  const cwd = opts.cwd ? resolve(opts.cwd) : process.cwd();

  let target;
  try {
    target = await resolveTarget({
      model: opts.model,
      provider: opts.provider,
    });
  } catch (e) {
    if (e instanceof ResolveError) {
      printError(e.message);
      process.exitCode = 1;
      return;
    }
    throw e;
  }

  const mode: Mode = opts.plan
    ? "plan"
    : opts.build
      ? "build"
      : (cfg.mode ?? "build");

  const sessionCfg: SessionConfig = {
    provider: target.provider,
    cred: target.cred,
    model: target.model,
    mode,
    cwd,
    maxTokens: opts.maxTokens ? Number(opts.maxTokens) : undefined,
  };
  let session = new Session(sessionCfg);

  const initial = promptParts.join(" ").trim();

  // One-shot mode: run the prompt and exit.
  if (opts.once) {
    if (!initial) {
      printError("`--once` requires a prompt.");
      process.exitCode = 1;
      return;
    }
    await session.send(initial);
    return;
  }

  // Default interactive experience: the full-screen Ink TUI. Requires a real
  // terminal on both ends; `--no-tui` or a non-TTY falls back to the line REPL.
  const interactiveTty = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (opts.tui !== false && interactiveTty) {
    await launchTui(sessionCfg, initial || undefined);
    return;
  }

  p.intro(
    ui.brand("τ tau") +
      ui.dim(`  ${target.provider.name} · ${target.model} · ${mode} mode`),
  );
  console.log(
    ui.dim(
      `  cwd: ${cwd}\n  Type a request, or /help for commands. Ctrl+C to exit.\n`,
    ),
  );

  if (initial) await session.send(initial);

  // Interactive REPL.
  for (;;) {
    // Hint the inverse mode toggle next to the label, e.g. in build mode show
    // "(/plan for plan mode)".
    const other = session.mode === "plan" ? "build" : "plan";
    const label = ui.violet(`${session.mode} ›`);
    const modeHint = ui.dim(`(/${other} for ${other} mode)`);
    const input = await p.text({
      message: `${label} ${modeHint}`,
      placeholder:
        "type a request, or / for commands (/help /mode /clear /exit)",
    });
    if (p.isCancel(input)) {
      p.outro(ui.dim("Bye."));
      return;
    }
    const text = (input as string).trim();
    if (!text) continue;

    if (text.startsWith("/")) {
      const stop = handleSlash(
        text,
        () => session,
        (s) => (session = s),
        sessionCfg,
      );
      if (stop === "exit") {
        p.outro(ui.dim("Bye."));
        return;
      }
      continue;
    }
    await session.send(text);
  }
}

/** Handle in-REPL slash commands. Returns "exit" to leave the loop. */
function handleSlash(
  text: string,
  getSession: () => Session,
  setSession: (s: Session) => void,
  baseCfg: SessionConfig,
): "exit" | void {
  const [cmd, arg] = text.slice(1).split(/\s+/, 2);

  // Switch to `next` mode, carrying the existing transcript across.
  const switchMode = (next: Mode): void => {
    if (getSession().mode === next) {
      console.log(ui.dim(`  Already in ${next} mode.`));
      return;
    }
    const carried = new Session({ ...baseCfg, mode: next });
    carried.messages.push(...getSession().messages);
    setSession(carried);
    console.log(ui.dim(`  Switched to ${next} mode.`));
  };

  switch (cmd) {
    case "exit":
    case "quit":
    case "q":
      return "exit";

    case "help":
      console.log(
        [
          ui.heading("Commands"),
          `  ${ui.bold("/plan")}               switch to plan mode (read-only)`,
          `  ${ui.bold("/build")}              switch to build mode (all tools)`,
          `  ${ui.bold("/mode")} [plan|build]  toggle or set the agent mode`,
          `  ${ui.bold("/clear")}              start a fresh conversation`,
          `  ${ui.bold("/info")}               show the current model & mode`,
          `  ${ui.bold("/exit")}               quit`,
          "",
        ].join("\n"),
      );
      return;

    case "info":
      console.log(
        ui.dim(
          `  ${baseCfg.provider.name} · ${baseCfg.model} · ${getSession().mode} mode · cwd ${baseCfg.cwd}`,
        ),
      );
      return;

    case "clear": {
      setSession(new Session({ ...baseCfg, mode: getSession().mode }));
      console.log(ui.dim("  Conversation cleared."));
      return;
    }

    case "plan":
      switchMode("plan");
      return;

    case "build":
      switchMode("build");
      return;

    case "mode": {
      const next = (
        arg === "plan" || arg === "build"
          ? arg
          : getSession().mode === "plan"
            ? "build"
            : "plan"
      ) as Mode;
      switchMode(next);
      return;
    }

    default:
      console.log(ui.warn(`  Unknown command: /${cmd} (try /help)`));
      return;
  }
}

export function registerRun(program: Command): void {
  program
    .command("run [prompt...]", { isDefault: true })
    .description("Start the coding agent (interactive REPL, or --once)")
    .option("-m, --model <id>", "Model to use")
    .option("-p, --provider <id>", "Provider to use")
    .option("--plan", "Start in plan mode (read-only tools)")
    .option("--build", "Start in build mode (all tools)")
    .option("-C, --cwd <dir>", "Working directory for the agent")
    .option("--once", "Run the prompt once and exit (no REPL)")
    .option("--no-tui", "Use the legacy line-based REPL instead of the TUI")
    .option("--max-tokens <n>", "Max output tokens per response")
    .action((parts: string[], opts: RunOptions) => run(parts, opts));
}
