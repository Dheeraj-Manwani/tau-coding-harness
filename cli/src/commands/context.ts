import type { Credential } from "../config/store.ts";
import { getCredential, readConfig } from "../config/store.ts";
import {
  CatalogError,
  defaultModelFor,
  ensureCatalog,
  findModel,
  getProvider,
  PROVIDERS,
  type ProviderInfo,
} from "../providers/registry.ts";

export interface ResolveOptions {
  provider?: string;
  model?: string;
}

export interface ResolvedTarget {
  provider: ProviderInfo;
  model: string;
  cred: Credential;
}

/** A clean, user-facing resolution error. */
export class ResolveError extends Error {}

/** Look up a stored credential for a provider. */
export async function credentialFor(
  provider: ProviderInfo,
): Promise<Credential | undefined> {
  return getCredential(provider.id);
}

/**
 * Resolve provider + model + credential from CLI flags, falling back to saved
 * config and finally to the first authenticated provider.
 */
export async function resolveTarget(
  opts: ResolveOptions,
): Promise<ResolvedTarget> {
  try {
    await ensureCatalog();
  } catch (e) {
    if (e instanceof CatalogError) throw new ResolveError(e.message);
    throw e;
  }
  const cfg = await readConfig();

  // 1. Determine the provider.
  let provider: ProviderInfo | undefined;
  if (opts.provider) {
    provider = getProvider(opts.provider);
    if (!provider) throw new ResolveError(`Unknown provider: ${opts.provider}`);
  } else if (opts.model) {
    provider = findModel(opts.model)?.provider;
  }
  if (!provider && cfg.defaultProvider)
    provider = getProvider(cfg.defaultProvider);
  if (!provider) provider = await firstAuthenticated();
  if (!provider) {
    throw new ResolveError(
      "No provider configured. Run `tau login` to add one.",
    );
  }

  // 2. Credential for that provider. If the provider was inferred from config
  // (not an explicit flag) but has no credential, fall back to any provider
  // that is authenticated — e.g. after logging out of the saved default.
  let cred = await credentialFor(provider);
  if (!cred && !opts.provider && !opts.model) {
    const fallback = await firstAuthenticated();
    if (fallback) {
      provider = fallback;
      cred = await credentialFor(provider);
    }
  }
  if (!cred) {
    throw new ResolveError(
      `Not authenticated with ${provider.name}. Run \`tau login\`.`,
    );
  }

  // 3. Model.
  let model = opts.model;
  if (
    !model &&
    cfg.defaultModel &&
    getProvider(provider.id)?.models.some((m) => m.id === cfg.defaultModel)
  ) {
    model = cfg.defaultModel;
  }
  if (!model) model = defaultModelFor(provider).id;

  return { provider, model, cred };
}

async function firstAuthenticated(): Promise<ProviderInfo | undefined> {
  for (const provider of PROVIDERS) {
    if (await credentialFor(provider)) return provider;
  }
  return undefined;
}
