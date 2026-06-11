import * as p from "@clack/prompts";
import type { Command } from "commander";
import { readConfig, updateConfig } from "../config/store.ts";
import {
  CatalogError,
  ensureCatalog,
  getProvider,
  PROVIDERS,
} from "../providers/registry.ts";
import { credentialFor } from "./context.ts";
import { printError, printSuccess, ui } from "../ui/output.ts";

async function list(): Promise<void> {
  const cfg = await readConfig();
  console.log(ui.heading("Providers") + "\n");
  for (const provider of PROVIDERS) {
    const cred = await credentialFor(provider);
    const status = cred ? ui.ok("✓ API key") : ui.dim("○ not authenticated");
    const isDefault =
      cfg.defaultProvider === provider.id ? ui.accent(" ★ default") : "";
    console.log(
      `  ${status.padEnd(30)} ${ui.bold(provider.name)} ` +
        ui.dim(`(${provider.id})`) +
        isDefault,
    );
  }
  console.log();
}

async function setDefault(providerArg?: string): Promise<void> {
  try {
    await ensureCatalog();
  } catch (e) {
    printError(e instanceof CatalogError ? e.message : String(e));
    return;
  }
  let providerId = providerArg;
  if (!providerId) {
    const choice = await p.select({
      message: "Set default provider",
      options: PROVIDERS.map((pr) => ({ value: pr.id, label: pr.name })),
    });
    if (p.isCancel(choice)) return p.cancel("Cancelled.");
    providerId = choice;
  }

  const provider = getProvider(providerId);
  if (!provider) {
    printError(`Unknown provider: ${providerId}`);
    return;
  }

  const choice = await p.select({
    message: "Select default model",
    options: provider.models.map((mod) => ({
      label: mod.name + (mod.recommended ? " (Default)" : ""),
      value: mod.id,
    })),
  });
  if (p.isCancel(choice)) return p.cancel("Cancelled.");
  const modelId = choice;

  await updateConfig({
    defaultProvider: provider.id,
    defaultModel: modelId,
  });
  printSuccess(
    `Default provider set to ${provider.name} (model: ${modelId}).`,
  );
}

export function registerProviders(program: Command): void {
  const providers = program
    .command("providers")
    .alias("provider")
    .description("List providers and set the default")
    .action(() => list());

  providers
    .command("default [provider]")
    .alias("set")
    .description("Set the default provider")
    .action((provider) => setDefault(provider));

  program
    .command("default [provider]")
    .alias("set")
    .description("Set the default provider")
    .action((provider) => setDefault(provider));
}
