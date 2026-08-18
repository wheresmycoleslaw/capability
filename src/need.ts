import type { JsonValue } from "./types.js";
import { createCapabilityGap, metabolizeIntent, type MetabolicSubstrate } from "./metabolism.js";

export type AbilitySourceKind = "native" | "connector" | "mcp" | "openapi" | "npm" | "pypi" | "oci" | "repository" | "composition" | "gap";

export type AbilityCandidate = {
  kind: AbilitySourceKind;
  id: string;
  description?: string;
  ready: boolean;
  trusted?: boolean;
  score?: number;
  metadata?: Record<string, JsonValue>;
};

export type AbilityProviderContext = {
  intent: string;
  input?: unknown;
  approved?: boolean;
};

export interface AbilityProvider {
  readonly id: string;
  readonly kind: AbilitySourceKind;
  readonly priority: number;
  readonly description: string;
  discover(context: AbilityProviderContext): Promise<readonly AbilityCandidate[]>;
  execute?(candidate: AbilityCandidate, context: AbilityProviderContext): Promise<unknown>;
}

export type NeedResolution = {
  intent: string;
  status: "ready" | "executed" | "unresolved";
  provider?: string;
  source?: AbilitySourceKind;
  candidate?: AbilityCandidate;
  result?: unknown;
  receipt?: unknown;
  considered: { provider: string; kind: AbilitySourceKind; candidates: number; detail?: string }[];
};

export class AbilityProviderRegistry {
  private readonly providers = new Map<string, AbilityProvider>();

  register(provider: AbilityProvider): this {
    if (!provider.id.trim()) throw new TypeError("provider.id is required");
    if (!provider.description.trim()) throw new TypeError("provider.description is required");
    if (!Number.isFinite(provider.priority)) throw new TypeError("provider.priority must be finite");
    if (this.providers.has(provider.id)) throw new Error(`Ability provider already registered: ${provider.id}`);
    this.providers.set(provider.id, provider);
    return this;
  }

  list(): readonly AbilityProvider[] {
    return [...this.providers.values()].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  }
}

export type NeedOptions = AbilityProviderContext & {
  providers?: AbilityProviderRegistry;
  execute?: boolean;
  indexes?: readonly string[];
  pythonPackage?: string;
  pythonVersion?: string;
  ociImage?: string;
  ociArgs?: string[];
  externalOnly?: boolean;
  allowUnverifiedSource?: boolean;
};

/**
 * Resolve an intent through the simplest production-ready provider first.
 *
 * Providers are intentionally substrate-agnostic at the call site: a caller asks
 * for an ability, while providers decide whether an existing connector, MCP tool,
 * OpenAPI operation, native Capability, or another prepared integration can satisfy
 * it. Capability's software-metabolism engine is the final fallback rather than the
 * front door.
 */
export async function need(intent: string, options: NeedOptions = { intent: "" }): Promise<NeedResolution> {
  if (!intent.trim()) throw new TypeError("intent is required");
  const context: AbilityProviderContext = {
    intent,
    ...(options.input !== undefined ? { input: options.input } : {}),
    ...(options.approved !== undefined ? { approved: options.approved } : {})
  };
  const considered: NeedResolution["considered"] = [];

  for (const provider of options.providers?.list() ?? []) {
    let candidates: readonly AbilityCandidate[];
    try {
      candidates = await provider.discover(context);
    } catch (error) {
      considered.push({ provider: provider.id, kind: provider.kind, candidates: 0, detail: error instanceof Error ? error.message : String(error) });
      continue;
    }
    const ready = [...candidates]
      .filter((candidate) => candidate.ready)
      .sort((a, b) => Number(Boolean(b.trusted)) - Number(Boolean(a.trusted)) || (b.score ?? 0) - (a.score ?? 0))[0];
    considered.push({ provider: provider.id, kind: provider.kind, candidates: candidates.length });
    if (!ready) continue;
    if (options.execute && provider.execute) {
      const result = await provider.execute(ready, context);
      return { intent, status: "executed", provider: provider.id, source: provider.kind, candidate: ready, result, considered };
    }
    return { intent, status: "ready", provider: provider.id, source: provider.kind, candidate: ready, considered };
  }

  const fallback = await metabolizeIntent(intent, {
    ...(options.input !== undefined ? { input: options.input } : {}),
    ...(options.approved !== undefined ? { approved: options.approved } : {}),
    ...(options.indexes ? { indexes: options.indexes } : {}),
    ...(options.pythonPackage ? { pythonPackage: options.pythonPackage } : {}),
    ...(options.pythonVersion ? { pythonVersion: options.pythonVersion } : {}),
    ...(options.ociImage ? { ociImage: options.ociImage } : {}),
    ...(options.ociArgs ? { ociArgs: options.ociArgs } : {}),
    ...(options.externalOnly !== undefined ? { externalOnly: options.externalOnly } : {}),
    ...(options.allowUnverifiedSource !== undefined ? { allowUnverifiedSource: options.allowUnverifiedSource } : {})
  });

  const fallbackKind: AbilitySourceKind = fallback.route as MetabolicSubstrate;
  considered.push({ provider: "capability/software-world", kind: fallbackKind, candidates: fallback.route === "gap" ? 0 : 1 });
  if (fallback.route === "gap") {
    return {
      intent,
      status: "unresolved",
      source: "gap",
      result: fallback.gap ?? createCapabilityGap(intent),
      considered
    };
  }
  return {
    intent,
    status: fallback.receipt ? "executed" : "ready",
    provider: "capability/software-world",
    source: fallbackKind,
    result: fallback.result,
    receipt: fallback.receipt,
    considered
  };
}

/** Convenience provider for prepared integrations discovered outside Capability core. */
export function defineAbilityProvider(provider: AbilityProvider): AbilityProvider {
  return provider;
}
