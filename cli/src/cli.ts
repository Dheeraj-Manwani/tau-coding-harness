import { Command } from "commander";
import { registerAuth } from "./commands/auth.ts";
import { registerModels } from "./commands/models.ts";
import { registerProviders } from "./commands/providers.ts";
import { registerConfig } from "./commands/config.ts";
import { registerRun } from "./commands/run.ts";

const program = new Command();

program
  .name("tau")
  .description("tau - a terminal coding agent")
  .version("0.1.0");

registerAuth(program);
registerProviders(program);
registerModels(program);
registerConfig(program);
registerRun(program);

program.parseAsync().catch((err) => {
  console.error(err?.message ?? err);
  process.exitCode = 1;
});
