import { inspectCapability } from "./define.js";
import { CapabilityRuntime } from "./runtime.js";
import { permissivePolicy } from "./policy.js";
import type { Capability, JsonValue } from "./types.js";
import { createCapabilityGap, metabolizeIntent, type MetabolicSubstrate } from "./metabolism.js";

export type AbilitySourceKind = "native" | "connector" | "mcp" | "openapi" | "npm" | "pypi" | "oci" | "repository" | "composition" | "gap";

export type AbilityCandidate = {
  kind: AbilitySourceKind;
  id: string;
  name?: string;
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
  close?(): void | Promise<void>;
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

  async close(): Promise<void> {
    await Promise.allSettled(this.list().map((provider) => provider.close?.()));
  }
}

export type NeedOptions = Omit<AbilityProviderContext, "intent"> & {
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

function tokens(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter((part) => part.length > 1);
}

function lexicalScore(intent: string, capability: Capability): number {
  const manifest = inspectCapability(capability);
  const intentTokens = new Set(tokens(intent));
  if (!intentTokens.size) return 0;
  const fields = [manifest.id, manifest.name, manifest.description, ...(manifest.tags ?? [])].join(" ").toLowerCase();
  let hits = 0;
  for (const token of intentTokens) if (fields.includes(token)) hits += 1;
  return hits / intentTokens.size;
}

/**
 * Turn an already-prepared set of capabilities into a preferred provider.
 *
 * This is the bridge used by MCP, OpenAPI, managed connectors, native packages,
 * and application-specific catalogs. It deliberately reuses CapabilityRuntime so
 * prepared integrations receive the same authorization and receipt semantics as
 * acquired software.
 */
export function providerFromCapabilities(options: {
  id: string;
  kind: Exclude<AbilitySourceKind, "gap">;
  priority?: number;
  description: string;
  capabilities: readonly Capability[];
  trusted?: boolean;
}): AbilityProvider {
  const byId = new Map(options.capabilities.map((capability) => [capability.manifest.id, capability]));
  return {
    id: options.id,
    kind: options.kind,
    priority: options.priority ?? 20,
    description: options.description,
    async discover({ intent }) {
      return [...byId.values()]
        .map((capability) => {
          const manifest = inspectCapability(capability);
          return {
            kind: options.kind,
            id: manifest.id,
            name: manifest.name,
            description: manifest.description,
            ready: true,
            trusted: options.trusted ?? false,
            score: lexicalScore(intent, capability),
            metadata: { version: manifest.version }
          } satisfies AbilityCandidate;
        })
        .filter((candidate) => (candidate.score ?? 0) > 0)
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    },
    async execute(candidate, context) {
      const capability = byId.get(candidate.id);
      if (!capability) throw new Error(`Capability ${candidate.id} is no longer available from provider ${options.id}`);
      const runtime = new CapabilityRuntime({ policy: permissivePolicy }).register(capability);
      const input = context.input === undefined ? {} : context.input;
      const receipt = await runtime.invoke(candidate.id, input, { approved: context.approved ?? false });
      return { output: receipt.output, receipt };
    }
  };
}

/**
 * Resolve an intent through the simplest production-ready provider first.
 *
 * Prepared providers are always consulted before Capability attempts package,
 * container, or repository acquisition. The caller asks for an ability; substrate
 * selection is an implementation detail unless diagnostics are requested.
 */
export async function need(intent: string, options: NeedOptions = {}): Promise<NeedResolution> {
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
      const record = result && typeof result === "object" && !Array.isArray(result) ? result as Record<string, unknown> : undefined;
      return {
        intent,
        status: "executed",
        provider: provider.id,
        source: provider.kind,
        candidate: ready,
        result: record?.output ?? result,
        ...(record?.receipt !== undefined ? { receipt: record.receipt } : {}),
        considered
      };
    }
    return { intent, status: "ready", provider: provider.id, source: provider.kind, candidate: ready, considered };
  }

  const fallback = await metabolizeIntent(intent, {
    ...(options.execute && options.input !== undefined ? { input: options.input } : {}),
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

/** Convenience helper for prepared integrations discovered outside Capability core. */
export function defineAbilityProvider(provider: AbilityProvider): AbilityProvider {
  return provider;
}
