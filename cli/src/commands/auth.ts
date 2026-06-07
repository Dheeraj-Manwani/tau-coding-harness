import * as p from "@clack/prompts";
import type { Command } from "commander";
import {
  clearAuth,
  readAuth,
  readConfig,
  removeCredential,
  setCredential,
  updateConfig,
  type Credential,
} from "../config/store.ts";
import { getProvider, PROVIDERS } from "../providers/registry.ts";
import { printError, printSuccess, ui } from "../ui/output.ts";

function cancelled(value: unknown): boolean {
  if (p.isCancel(value)) {
    p.cancel("Cancelled.");
    return true;
  }
  return false;
}

async function login(
  providerArg?: string,
  opts: { apiKey?: string } = {},
): Promise<void> {
  p.intro(ui.brand("tau login"));

  let providerId = providerArg;
  if (!providerId) {
    const choice = await p.select({
      message: "Which provider do you want to authenticate with?",
      options: PROVIDERS.map((pr) => ({
        value: pr.id,
        label: pr.name,
        hint: "api key",
      })),
    });
    if (cancelled(choice)) return;
    providerId = choice as string;
  }

  const provider = getProvider(providerId);
  if (!provider) {
    printError(`Unknown provider: ${providerId}`);
    return;
  }

  let cred: Credential;

  if (opts.apiKey) {
    cred = { type: "api", key: opts.apiKey };
  } else {
    const key = await p.password({
      message: `Paste your ${provider.name} API key`,
      validate: (v) => (!v || v.trim().length === 0 ? "Required" : undefined),
    });
    if (cancelled(key)) return;
    cred = { type: "api", key: (key as string).trim() };
  }

  await setCredential(provider.id, cred);

  const cfg = await readConfig();
  if (!cfg.defaultProvider) {
    await updateConfig({ defaultProvider: provider.id });
  }

  p.outro(ui.ok(`Authenticated with ${provider.name}.`));
}

async function logout(providerArg?: string): Promise<void> {
  const auth = await readAuth();
  const authed = Object.keys(auth);

  if (authed.length === 0) {
    printError("No stored credentials.");
    return;
  }

  if (providerArg) {
    const id = getProvider(providerArg)?.id ?? providerArg;
    const ok = await removeCredential(id);
    if (ok) printSuccess(`Removed credentials for ${id}.`);
    else printError(`No stored credentials for ${providerArg}.`);
    return;
  }

  const choice = await p.select({
    message: "Remove which credentials?",
    options: [
      ...authed.map((id) => ({
        value: id,
        label: getProvider(id)?.name ?? id,
      })),
      { value: "__all__", label: ui.warn("All providers") },
    ],
  });
  if (cancelled(choice)) return;

  if (choice === "__all__") {
    await clearAuth();
    printSuccess("Removed all stored credentials.");
  } else {
    await removeCredential(choice as string);
    printSuccess(
      `Removed credentials for ${getProvider(choice as string)?.name}.`,
    );
  }
}

async function list(): Promise<void> {
  const auth = await readAuth();
  console.log(ui.heading("Authentication status") + "\n");
  for (const provider of PROVIDERS) {
    const cred = auth[provider.id];
    const status = cred ? ui.ok("√ api key") : ui.dim("○ not signed in");
    console.log(`  ${status.padEnd(30)} ${provider.name}`);
  }
}

export function registerAuth(program: Command): void {
  const auth = program
    .command("auth")
    .description("Manage provider credentials");

  auth
    .command("login [provider]")
    .description("Sign in to a provider with an API key")
    .option("--api-key <key>", "Provide an API key non-interactively")
    .action((provider, opts) => login(provider, opts));

  auth
    .command("logout [provider]")
    .description("Remove stored credentials")
    .action((provider) => logout(provider));

  auth
    .command("list")
    .alias("ls")
    .description("Show which providers are authenticated")
    .action(() => list());

  program
    .command("list")
    .alias("ls")
    .description("Show which providers are authenticated")
    .action(() => list());

  program
    .command("login [provider]")
    .description("Alias for `auth login`")
    .option("--api-key <key>", "Provide an API key non-interactively")
    .action((provider, opts) => login(provider, opts));

  program
    .command("logout [provider]")
    .description("Alias for `auth logout`")
    .action((provider) => logout(provider));
}
