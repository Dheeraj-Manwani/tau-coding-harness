import type { Command } from "commander";
import { authPath, configDir, configPath } from "../config/paths.ts";
import { readConfig } from "../config/store.ts";
import { ui } from "../ui/output.ts";

async function show(): Promise<void> {
  const cfg = await readConfig();
  console.log(ui.heading("tau configuration") + "\n");
  console.log(`  ${ui.dim("config dir")}      ${configDir()}`);
  console.log(`  ${ui.dim("config file")}     ${configPath()}`);
  console.log(`  ${ui.dim("auth file")}       ${authPath()}`);
  console.log();
  console.log(`  ${ui.dim("default provider")} ${cfg.defaultProvider ?? ui.dim("(unset)")}`);
  console.log(`  ${ui.dim("default model")}    ${cfg.defaultModel ?? ui.dim("(unset)")}`);
  console.log(`  ${ui.dim("default mode")}     ${cfg.mode ?? "build"}`);
  console.log();
}

export function registerConfig(program: Command): void {
  program
    .command("config")
    .description("Show config file locations and current settings")
    .action(() => show());
}
