import * as p from "@clack/prompts";
import type { Command } from "commander";
import { readConfig, updateConfig } from "../config/store.ts";
import { findModel, getProvider, PROVIDERS } from "../providers/registry.ts";
import { credentialFor } from "./context.ts";
import { printError, printSuccess, ui } from "../ui/output.ts";

async function list(opts: { provider?: string } = {}): Promise<void> {
  const cfg = await readConfig();
  const providers = opts.provider
    ? PROVIDERS.filter((p) => p.id === opts.provider)
    : PROVIDERS;

  if (providers.length === 0) {
    printError(`Unknown provider: ${opts.provider}`);
    return;
  }

  for (const provider of providers) {
    const authed = (await credentialFor(provider)) ? ui.ok("authed") : ui.dim("no auth");
    console.log("\n" + ui.heading(provider.name) + ui.dim(`  (${provider.id} · ${authed})`));
    for (const model of provider.models) {
      const isDefault = cfg.defaultModel === model.id && cfg.defaultProvider === provider.id;
      const marker = isDefault ? ui.accent(" ★ default") : "";
      const ctx = model.context ? ui.dim(` · ${(model.context / 1000).toFixed(0)}k ctx`) : "";
      console.log(`  ${ui.bold(model.id)}${ctx}${marker}`);
      console.log(`    ${ui.dim(model.name)}`);
    }
  }
  console.log();
}

async function setDefault(modelArg?: string): Promise<void> {
  let modelId = modelArg;

  if (!modelId) {
    const provChoice = await p.select({
      message: "Pick a provider",
      options: PROVIDERS.map((pr) => ({ value: pr.id, label: pr.name })),
    });
    if (p.isCancel(provChoice)) return p.cancel("Cancelled.");
    const provider = getProvider(provChoice as string)!;
    const modelChoice = await p.select({
      message: `Default model for ${provider.name}`,
      options: provider.models.map((m) => ({
        value: m.id,
        label: m.id,
        hint: m.recommended ? "recommended" : undefined,
      })),
    });
    if (p.isCancel(modelChoice)) return p.cancel("Cancelled.");
    await updateConfig({ defaultProvider: provider.id, defaultModel: modelChoice as string });
    printSuccess(`Default model set to ${modelChoice} (${provider.name}).`);
    return;
  }

  const found = findModel(modelId);
  if (!found) {
    printError(`Unknown model: ${modelId}. Run \`tau models\` to see options.`);
    return;
  }
  await updateConfig({ defaultProvider: found.provider.id, defaultModel: found.model.id });
  printSuccess(`Default model set to ${found.model.id} (${found.provider.name}).`);
}

export function registerModels(program: Command): void {
  const models = program
    .command("models")
    .description("List models and set the default")
    .option("-p, --provider <id>", "Only show models for this provider")
    .action((opts) => list(opts));

  models
    .command("default [model]")
    .alias("set")
    .description("Set the default model")
    .action((model) => setDefault(model));
}
