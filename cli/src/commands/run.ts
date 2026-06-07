import * as p from "@clack/prompts";
import type { Command } from "commander";
import { resolve } from "node:path";
import { readConfig } from "../config/store.ts";
import { Session, type Mode, type SessionConfig } from "../agent/session.ts";
import { resolveTarget, ResolveError } from "./context.ts";
import { printError, ui } from "../ui/output.ts";

interface RunOptions {
  model?: string;
  provider?: string;
  plan?: boolean;
  build?: boolean;
  cwd?: string;
  once?: boolean;
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

  p.intro(
    ui.brand("tau") +
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
    const input = await p.text({
      message:
        session.mode === "plan" ? ui.info("plan ›") : ui.accent("build ›"),
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

  switch (cmd) {
    case "exit":
    case "quit":
    case "q":
      return "exit";

    case "help":
      console.log(
        [
          ui.heading("Commands"),
          `  ${ui.bold("/mode")} [plan|build]  switch agent mode (read-only vs full)`,
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

    case "mode": {
      const next = (
        arg === "plan" || arg === "build"
          ? arg
          : getSession().mode === "plan"
            ? "build"
            : "plan"
      ) as Mode;
      // Carry the existing transcript into the new mode.
      const carried = new Session({ ...baseCfg, mode: next });
      carried.messages.push(...getSession().messages);
      setSession(carried);
      console.log(ui.dim(`  Switched to ${next} mode.`));
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
    .action((parts: string[], opts: RunOptions) => run(parts, opts));
}
